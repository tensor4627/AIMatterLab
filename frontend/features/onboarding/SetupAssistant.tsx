import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, BookOpen, Box, Check, ChevronRight, Circle, Cpu, ExternalLink, FlaskConical, FolderOpen, GitBranch, KeyRound, Laptop, Layers3, MessageSquare, Monitor, Moon, Network, Play, Server, SlidersHorizontal, Sun, Terminal} from 'lucide-react';
import type {AgentProvider} from '../../../contracts/dto/agent';
import type {ComputeResourceState} from '../../../contracts/dto/compute';
import type {Settings} from '../../../contracts/dto/settings';
import type {SetupGuideInfo, SetupPage, SetupProgress} from '../../../contracts/dto/setup-guide';
import {invoke} from '../../api/studio';
import {Modal} from '../../ui/Dialogs';
import {providerAccountState,providerNames} from '../conversations/provider-account.mjs';
import ProviderLogin from '../settings/ProviderLogin';
import GuideSpotlight from './GuideSpotlight';
import CopperCell from './CopperCell';
import './setup-assistant.css';

const pages: SetupPage[] = ['welcome','agent','compute','ready'];
const providers: AgentProvider[] = ['codex','kimi','qwen','deepseek','compatible'];
export type SetupVisit = 'assets' | 'environments' | 'extensions' | 'runs' | 'model-test' | 'tour-goal' | 'short-check';
export type SetupPreferences = Pick<Partial<Settings>, 'language' | 'theme' | 'agentProvider'>;
export type ModelReply = {provider:AgentProvider; model:string};
type Props = {
  info:SetupGuideInfo; page:SetupPage; settings:Settings; localConnected:boolean; resource:ComputeResourceState|null;
  agentBusy:boolean; reply:ModelReply|null; onReply:(result:ModelReply|null)=>void;
  onPreferences:(patch:SetupPreferences)=>Promise<void>; onProgress:(page:SetupProgress)=>Promise<void>;
  onConnect:(kind:'wsl'|'ssh')=>void; onVisit:(destination:SetupVisit, shortCase?:string)=>void;
};

export default function SetupAssistant({info,page,settings,localConnected,resource,agentBusy,reply,onReply,onPreferences,onProgress,onConnect,onVisit}:Props) {
  const english=settings.language==='en';
  const say=(zh:string,en:string)=>english?en:zh;
  const [login,setLogin]=useState(false),[tour,setTour]=useState<number|null>(null),[checks,setChecks]=useState(false);
  const [toolSetup,setToolSetup]=useState(false);
  const [shortCase,setShortCase]=useState('worker'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [accountVisited,setAccountVisited]=useState<AgentProvider|null>(null),[connectionVisited,setConnectionVisited]=useState<'wsl'|'ssh'|null>(null);
  const routeChosen=useRef(false);
  const [route,setRoute]=useState<'wsl'|'ssh'|'later'>(()=>resource?.kind?'ssh':localConnected?'wsl':'later');
  useEffect(()=>{if(!routeChosen.current)setRoute(resource?.kind?'ssh':localConnected?'wsl':'later');},[resource?.kind,localConnected]);
  const heading=useRef<HTMLHeadingElement>(null),pending=useRef(false),mounted=useRef(false);
  const summary=useRef<HTMLDivElement>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{heading.current?.focus({preventScroll:true});summary.current?.scrollTo(0,0);setError('');},[page]);
  const index=pages.indexOf(page);
  const labels=[say('欢迎','Welcome'),say('助手','Agent'),say('算力','Compute'),say('开始','Start')];
  const titles=[say('欢迎使用 AIMatterLab','Welcome to AIMatterLab'),say('选择你的 AI 助手','Choose your AI assistant'),say('在哪里运行计算？','Where will you compute?'),say('开始使用工作台','Explore your workspace')];
  const provider=settings.agentProvider||'codex';
  const names:Record<string,string>={...providerNames,compatible:say('自定义 API','Custom API')};
  const [account,setAccount]=useState<{provider:AgentProvider;state:ReturnType<typeof providerAccountState>}|null>(null);
  useEffect(()=>{
    if(login||accountVisited!==provider)return;
    let active=true;
    void invoke('agent.account',{provider}).then(value=>{
      if(active)setAccount({provider,state:providerAccountState(provider,value)});
    }).catch(()=>{if(active)setAccount({provider,state:'unknown'});});
    return ()=>{active=false;};
  },[provider,accountVisited,login]);
  const methods:Record<AgentProvider,string>={codex:say('ChatGPT 账号或 API Key','ChatGPT account or API key'),kimi:say('设备授权登录','Device sign-in'),qwen:say('订阅或按量 API','Subscription or usage-based API'),deepseek:say('开放平台密钥','Platform API key'),compatible:say('自选地址、协议和模型','Your endpoint, protocol and model')};
  const tourItems=[
    {icon:Box,title:say('导入结构','Import a structure'),body:say('在「数据资产」导入结构文件或用 ASE 创建晶胞。以左侧的铜为例，先核对元素、晶格和周期边界。','In Data assets, import a structure or create a cell with ASE. For copper, check the element, lattice and periodic boundaries.')},
    {icon:MessageSquare,title:say('描述目标','Describe your goal'),body:say('在普通对话中描述想观察的量。准备生成流程时开启「任务规划」，例如询问怎样得到铜的轨迹和温度随时间的变化。','Discuss what you want to measure. Enable task planning when ready to build a workflow, for example to obtain a copper trajectory and a temperature time series.')},
    {icon:GitBranch,title:say('核对流程','Review the workflow'),body:say('在流程图中点开结构、势模型和 MD 节点，核对输入文件、温度、步长与输出频率。','Open the structure, potential and MD nodes. Check the input files, temperature, time step and output interval.')},
    {icon:SlidersHorizontal,title:say('预览部署','Preview deployment'),body:say('在部署页选择计算项目和已登记的环境，预览工作目录、资源和实际命令。准备就绪后由你选择执行。','Choose a project and registered environment. Review the directory, resources and commands, then decide when to execute.')},
    {icon:Layers3,title:say('查看结果','Inspect the results'),body:say('在「运行记录」打开实际任务，查看状态、日志、轨迹与结果文件。','Open the job in Run history to inspect its status, logs, trajectory and result files.')}
  ];
  async function act(operation:()=>Promise<void>) {
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');
    try{await operation();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:String(e));}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  const move=(next:SetupProgress)=>void act(()=>onProgress(next));
  const preference=(patch:SetupPreferences)=>void act(()=>onPreferences(patch));
  const ssh=!!resource?.kind&&resource.status==='selected';
  const auth=ssh&&resource?.authentication==='verified';
  const service=ssh ? resource?.capabilities?.service.status==='connected'||resource?.workflowReady===true : localConnected;
  const connection=ssh ? auth?say('SSH 已登录','SSH signed in'):say('SSH 身份待核对','SSH identity unverified') : localConnected?say('WSL 已连接','WSL connected'):say('尚未连接','Not connected');
  const tested=reply?.provider===provider?reply:null;
  const openAccount=()=>{setAccount(null);setAccountVisited(provider);setError('');setLogin(true);};
  function openConnection(){if(route==='later')return;setConnectionVisited(route);onConnect(route);}
  const accountNext=page==='agent'&&accountVisited!==provider&&!tested;
  const connectNext=page==='compute'&&route!=='later'&&connectionVisited!==route&&!(route==='wsl'?localConnected:auth);
  const connectionAction=route==='ssh'?say('配置 SSH 连接','Set up SSH'):say('选择 WSL 发行版','Choose WSL distribution');
  return <>
    <section className="setup-screen" data-testid="setup-assistant" aria-labelledby="setup-heading">
      <div className="setup-sheet">
        <CopperCell english={english}/>
        <div className="setup-content">
          <header className="setup-progress"><ol aria-label={say('设置进度','Setup progress')}>{pages.map((step,i)=>
            <li key={step} aria-current={step===page?'step':undefined} data-done={i<index}>
              <span className="setup-step-mark">{i<index?<Check size={12}/>:i+1}</span>{labels[i]}</li>)}</ol>
            {page!=='ready'&&<button className="setup-text" disabled={busy} onClick={()=>move('complete')}>{say('跳过引导','Skip setup')}</button>}</header>
          <div className="setup-scroll" ref={summary}>
            <h1 id="setup-heading" ref={heading} tabIndex={-1}>{titles[index]}</h1>
            {page==='welcome'&&<div className="setup-welcome">
              <fieldset><legend>{say('界面语言','Language')}</legend><div className="setup-segments">{(['zh-CN','en'] as const).map(lang=><button key={lang} lang={lang} disabled={busy} aria-pressed={(settings.language||'zh-CN')===lang} onClick={()=>preference({language:lang})}>{lang==='en'?'English':'简体中文'}{(settings.language||'zh-CN')===lang&&<Check size={16}/>}</button>)}</div></fieldset>
              <fieldset><legend>{say('外观','Appearance')}</legend><div className="setup-themes">{(['light','dark'] as const).map(theme=><button key={theme} disabled={busy} aria-pressed={settings.theme===theme} onClick={()=>preference({theme})}>
                <span className={'setup-theme-preview '+theme} aria-hidden="true"><i/><i/><i/></span>
                {theme==='dark'?<Moon size={15}/>:<Sun size={15}/>} <span>{theme==='dark'?say('深色石墨','Graphite'):say('浅色','Light')}</span>{settings.theme===theme&&<Check className="setup-theme-check" size={15}/>}</button>)}</div></fieldset>
              <button className="setup-location" disabled={busy} title={info.directory} onClick={()=>void act(async()=>{await invoke('onboarding.openDirectory');})}><FolderOpen size={19}/><span><strong>{info.directoryKind==='profile'?say('本机配置目录','Local profile folder'):say('本机工作区','Local workspace')}</strong><small dir="auto">{info.directory}</small></span><ExternalLink size={15}/></button>
            </div>}
            {page==='agent'&&<>
              <fieldset><legend className="setup-sr">{say('服务商','Provider')}</legend><div className="setup-providers">{providers.map(id=><button key={id} disabled={busy||agentBusy} aria-pressed={provider===id} onClick={()=>{if(provider!==id)preference({agentProvider:id});}}>
                <span className="setup-provider-letter" data-provider={id}>{id==='compatible'?<Network size={17}/>:names[id][0]}</span>
                <span><strong>{names[id]}</strong><small>{methods[id]}</small></span>{provider===id&&<Check size={15}/>}</button>)}</div></fieldset>
              <div className="setup-inline-actions">{!accountNext&&<button className="setup-secondary" disabled={busy||agentBusy} onClick={openAccount}><KeyRound size={16}/>{say('配置账号','Configure account')}</button>}
                <button className="setup-text" disabled={busy||agentBusy} onClick={()=>onVisit('model-test')}><MessageSquare size={15}/>{say('试发一条消息','Try a message')}</button></div>
            </>}
            {page==='compute'&&<>
              <fieldset><legend className="setup-sr">{say('计算位置','Compute location')}</legend><div className="setup-routes">{([
                ['wsl',Laptop,say('本机 WSL','Local WSL'),say('使用这台 Windows 电脑上的 Linux 环境','Use a Linux environment on this Windows PC')],
                ['ssh',Server,say('远程集群','Remote cluster'),say('通过 SSH 登录实验室或计算中心','Sign in to a lab or computing centre via SSH')],
                ['later',Monitor,say('暂不连接','Connect later'),say('先与助手对话或浏览工作台','Start with a conversation or explore the workspace')]
              ] as const).map(([kind,Icon,label,detail])=><button key={kind} aria-pressed={route===kind} disabled={busy} onClick={()=>{routeChosen.current=true;setRoute(kind);}}><Icon size={21}/><span><strong>{label}</strong><small>{detail}</small></span><span className="setup-radio">{route===kind&&<i/>}</span></button>)}</div></fieldset>
              {route!=='later'&&!connectNext&&<div className="setup-inline-actions"><button className="setup-secondary" disabled={busy||agentBusy} onClick={openConnection}><Terminal size={16}/>{connectionAction}</button></div>}
              {route==='ssh'&&<p className="setup-note">{say('登录后，点击「登录完成，交由 AIMatterLab 管理」。在聊天中指定此资源即可申请专属终端。','After signing in, let AIMatterLab manage the connection. Name this resource in chat to request a dedicated terminal.')}</p>}
            </>}
            {page==='ready'&&<>
              <div className="setup-statuses">{account?.provider===provider&&<span><KeyRound size={12}/>{account.state==='configured'?say('账号已配置','Account configured'):account.state==='missing'?say('账号待配置','Account not configured'):say('账号状态待核对','Account status unconfirmed')}</span>}<span><Circle size={10} data-active={!!tested}/>{names[provider]} · {tested?say('模型已回复','Model replied')+' · '+tested.model:say('模型回复待验证','Model reply unverified')}</span><span><Circle size={10} data-active={localConnected||auth}/>{connection}</span>
                {(ssh||localConnected)&&<span><Circle size={10} data-active={service}/>{service?say('作业服务已连接','Job service connected'):say('作业服务待连接','Job service pending')}</span>}</div>
              {tour===null?<button className="setup-tour-start" onClick={()=>{setTour(0);setChecks(false);}}><span className="setup-tour-icon"><BookOpen size={22}/></span><span><strong>{say('跟着示例走一遍','Take the guided tour')}</strong><small>{say('铜晶胞的分子动力学流程','A molecular dynamics workflow for copper')}</small></span><ChevronRight size={19}/></button>:
                <div className="setup-tour"><div className="setup-tour-tabs" role="group" aria-label={say('示例操作','Tour steps')}>{tourItems.map(({icon:Icon,title},i)=><button key={title} title={title} aria-label={title} aria-pressed={tour===i} onClick={()=>setTour(i)}><Icon size={17}/></button>)}</div>
                  <div aria-live="polite"><h2>{tourItems[tour].title}</h2><p>{tourItems[tour].body}</p></div>
                  <div className="setup-tour-foot">
                    {tour===0&&<button className="setup-text" onClick={()=>onVisit('assets')}>{say('打开数据资产','Open data assets')}<ExternalLink size={14}/></button>}
                    {tour===1&&<button className="setup-text" disabled={agentBusy} onClick={()=>onVisit('tour-goal')}>{say('在对话中试写目标','Draft a goal in chat')}<ExternalLink size={14}/></button>}
                    <button className="setup-text" onClick={()=>setTour(null)}>{say('收起示例','Close tour')}</button>
                    <button className="setup-text" onClick={()=>tour===4?onVisit('runs'):setTour(tour+1)}>{tour===4?say('打开运行记录','Open run history'):say('下一步','Next step')}<ArrowRight size={15}/></button></div></div>}
              <div className="setup-links">
                <button aria-expanded={toolSetup} onClick={()=>{setToolSetup(!toolSetup);setChecks(false);}}><Cpu size={16}/>{say('配置我的第一个科学工具','Set up my first scientific tool')}<ChevronRight size={15}/></button>
                {toolSetup&&<div className="setup-tool-options">
                  <button className="setup-secondary" onClick={()=>onVisit('environments')}>{say('登记已有环境','Register an environment')}<ExternalLink size={14}/></button>
                  <button className="setup-secondary" onClick={()=>onVisit('extensions')}>{say('获取工具与安装说明','Get tools and install guides')}<ExternalLink size={14}/></button></div>}
                <button aria-expanded={checks} onClick={()=>{setChecks(!checks);setToolSetup(false);}}><FlaskConical size={16}/>{say('验证计算环境','Check a compute environment')}<ChevronRight size={15}/></button>
              </div>
              {checks&&<div className="setup-checks"><label>{say('选择安装短例','Choose an installation check')}<select value={shortCase} onChange={event=>setShortCase(event.target.value)}><option value="worker">{say('作业服务','Job service')}</option><option value="reference-md">ASE · CPU MD</option><option value="pydyn-md">PyDyn · CUDA MD</option></select></label><button className="setup-secondary" disabled={agentBusy} onClick={()=>onVisit('short-check',shortCase)}><Play size={15}/>{say('在对话中准备短例','Prepare check in chat')}</button></div>}
            </>}
            {error&&<p className="setup-error" role="alert">{error}</p>}
          </div>
          <footer className="setup-footer">
            {index>0&&<button className="setup-text" disabled={busy} onClick={()=>move(pages[index-1])}><ArrowLeft size={15}/>{say('上一步','Back')}</button>}
            {(accountNext||connectNext)&&<button className="setup-text setup-defer" disabled={busy} onClick={()=>move(pages[index+1])}>{say('稍后配置','Set up later')}</button>}
            <button className="setup-primary" disabled={busy||(accountNext||connectNext)&&agentBusy} onClick={()=>accountNext?openAccount():connectNext?openConnection():move(index===3?'complete':pages[index+1])}>
              {accountNext?say('配置账号','Configure account'):connectNext?connectionAction:index===3?say('进入工作台','Enter workspace'):say('继续','Continue')}<ArrowRight size={17}/></button>
          </footer>
        </div>
      </div>
    </section>
    {login&&<GuideSpotlight step="account" english={english}/>}
    {login&&<Modal title={names[provider]+' · '+say('账号与 API','Account and API')} onClose={()=>setLogin(false)}>{error&&<p role="alert" className="setup-error">{error}</p>}<ProviderLogin key={provider} embedded provider={provider} disabled={agentBusy} onClose={()=>setLogin(false)} onConfigured={()=>onReply(null)} onTested={model=>onReply({provider,model})} onError={e=>setError(e instanceof Error?e.message:String(e))}/></Modal>}
  </>;
}
