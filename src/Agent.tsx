import {tr} from './i18n';
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,Square,Plus,Sparkles,Check,Shield,LoaderCircle,Settings2} from 'lucide-react';
import {t} from './i18n';
import ProviderLogin from './ProviderLogin';
import {invoke,type RpcEvent,type AgentProvider} from './types';
type Message={id:string;role:string;text:string;runId?:string;diff?:string};
export default function Agent({context,onError,skill,width,onOpenRun,intent}:{intent?:{id:string;text:string};onOpenRun?:(id:string)=>void;width?:number;context:string;onError:(e:unknown)=>void;skill?:{name:string;path:string}}){
 const [provider,setProvider]=useState<AgentProvider>('codex'),[login,setLogin]=useState(false);
 useEffect(()=>{if(intent)setPrompt(intent.text);},[intent?.id]);
 const providerRef=useRef<AgentProvider>('codex');providerRef.current=provider;
 const [connected,setConnected]=useState(false),[connecting,setConnecting]=useState(false),[models,setModels]=useState<any[]>([]),[model,setModel]=useState('');
 const [thread,setThread]=useState<string|null>(null),[threads,setThreads]=useState<any[]>([]),[messages,setMessages]=useState<Message[]>([]);
 const [prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false),[turn,setTurn]=useState<string|null>(null),[account,setAccount]=useState<any>(null);
 const [requests,setRequests]=useState<RpcEvent[]>([]),[answers,setAnswers]=useState<Record<string,string>>({});
 const [effort,setEffort]=useState(localStorage.getItem('studio.effort')||''),[contextWindow,setContextWindow]=useState(''),[compactLimit,setCompactLimit]=useState(''),[options,setOptions]=useState(false),[usage,setUsage]=useState<any>(null),[applying,setApplying]=useState(false),[applied,setApplied]=useState('');
 const openRunRef=useRef(onOpenRun);openRunRef.current=onOpenRun;
 const currentModel=models.find(m=>m.model===model),efforts=currentModel?.supportedReasoningEfforts||[];
 useEffect(()=>{if(currentModel&&!efforts.some((e:any)=>e.reasoningEffort===effort))setEffort(currentModel.defaultReasoningEffort||'');},[model,models]);
 useEffect(()=>{if(model)localStorage.setItem('studio.model.'+provider,model);if(effort)localStorage.setItem('studio.effort.'+provider,effort);},[model,effort,provider]);
 const scroll=useRef<HTMLDivElement>(null),threadRef=useRef<string|null>(null);threadRef.current=thread;
 const rpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:providerRef.current,method,params});
 useEffect(()=>{
  void invoke('state').then(state=>{const selected=state.settings?.agentProvider||'codex';setProvider(selected);providerRef.current=selected;setThreads(selected==='codex'?state.threads||[]:[]);const a=selected==='codex'?state.settings?.agent||{}:state.settings?.agentProviders?.[selected]||{};setContextWindow(a.contextWindow?.toString()||'');setCompactLimit(a.compactLimit?.toString()||'');setEffort(localStorage.getItem('studio.effort.'+selected)||a.effort||'');}).catch(()=>{});
  return window.studio?.onEvent(event=>{
   if((event.provider||'codex')!==providerRef.current)return;
   if(event.method==='studio/accountUpdated')void invoke('agent.account',{provider:providerRef.current}).then(setAccount).catch(onError);
   if(event.method==='studio/configUpdated')void rpc('model/list').then(m=>{setModels(m.data||[]);}).catch(onError);
   if(event.id!==undefined){setRequests(prev=>[...prev.filter(r=>r.id!==event.id),event]);return;}
   const p=event.params||{};
   if(event.method==='serverRequest/resolved')setRequests(prev=>prev.filter(r=>String(r.id)!==String(p.requestId)));
   if(p.threadId && p.threadId!==threadRef.current)return;
   if(event.method==='item/agentMessage/delta')setMessages(prev=>{
    const id=p.itemId||'agent',existing=prev.find(m=>m.id===id);
    return existing?prev.map(m=>m.id===id?{...m,text:m.text+(p.delta||'')}:m):[...prev,{id,role:'agent',text:p.delta||''}];
   });
   if(event.method==='item/started' && p.item && ['mcpToolCall','commandExecution','fileChange'].includes(p.item.type))
    setMessages(prev=>[...prev,{id:p.item.id,role:'tool',text:p.item.tool||p.item.command||'文件变更'}]);
   if(event.method==='item/completed' && p.item?.type==='mcpToolCall'){
    let result:any;try{result=JSON.parse(p.item.result?.content?.find((c:any)=>c.type==='text')?.text||'null');}catch{}
    const runId=result?.engine?result.id:result?.run;
    if(result?.engine&&['prepare_run','resume_run'].includes(p.item.tool)&&['draft','ready'].includes(result.status))openRunRef.current?.(result.id);
    setMessages(prev=>prev.map(m=>m.id===p.item.id?{...m,runId:typeof runId==='string'?runId:undefined,text:m.text+'\n'+JSON.stringify(p.item.result??p.item.error??p.item.status,null,2)}:m));
   }
   if(event.method==='item/completed' && p.item?.type==='fileChange')setMessages(prev=>prev.map(m=>m.id===p.item.id?{...m,diff:p.item.changes?.map((c:any)=>c.path+'\n'+c.diff).join('\n')}:m));
   if(event.method==='thread/tokenUsage/updated')setUsage(p.tokenUsage);
   if(event.method==='turn/started'){setBusy(true);setTurn(p.turn?.id);}
   if(event.method==='turn/completed'){setBusy(false);setTurn(null);if(p.turn?.error)onError(p.turn.error.message||p.turn.error);}
   if(event.method==='error')onError(p.error?.message||JSON.stringify(p));
   if(event.method==='account/updated')void rpc('account/read').then(setAccount).catch(onError);
   if(event.method==='studio/codexDisconnected'){setConnected(false);setBusy(false);}
  });
 },[]);
 useEffect(()=>{scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'});},[messages,requests]);
 async function connect(){
  setConnecting(true);try{
   await invoke('agent.connect',{provider:providerRef.current});
   const [a,m,t]=await Promise.all([rpc('account/read',{refreshToken:false}),rpc('model/list'),rpc('thread/list',{limit:20})]);
   setAccount({...a,requiresAuthentication:!!m.authRequired});const list=m.data||[];setModels(list);setModel(list.find((v:any)=>v.model===localStorage.getItem('studio.model.'+providerRef.current))?.model||list.find((v:any)=>v.isDefault)?.model||list[0]?.model||'');
   setThreads(t.data||[]);setConnected(true);
  }catch(e){onError(e);}finally{setConnecting(false);}
 }
 async function selectProvider(value:AgentProvider){
  if(busy||connecting||applying)return;
  const old=providerRef.current;
  try{await invoke('agent.login.cancel');await invoke('agent.disconnect',{provider:old});await invoke('settings',{agentProvider:value});}catch(e){onError(e);return;}
  providerRef.current=value;setProvider(value);setConnected(false);setModels([]);setModel('');setThread(null);threadRef.current=null;setThreads([]);setMessages([]);setRequests([]);setUsage(null);setAccount(null);setOptions(false);setLogin(false);setEffort(localStorage.getItem('studio.effort.'+value)||'');
 }
 async function selectModel(value:string){
  if(provider==='codex'){setModel(value);return;}
  setApplying(true);try{const result=await rpc('model/select',{model:value});setModel(value);setModels(result.data||[]);}catch(e){onError(e);}finally{setApplying(false);}
 }
 async function resume(id:string){
  try{
   const r=await rpc('thread/resume',{threadId:id});setThread(r.thread.id);threadRef.current=r.thread.id;setModel(r.model||model);setEffort(r.reasoningEffort||'');setUsage(null);
   const read=await rpc('thread/read',{threadId:id,includeTurns:true}),list:Message[]=[];
   for(const turn of read.thread?.turns||[])for(const item of turn.items||[]){
    if(item.type==='agentMessage')list.push({id:item.id,role:'agent',text:item.text||''});
    if(item.type==='userMessage')list.push({id:item.id,role:'user',text:(item.content||[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n')});
   }
   setMessages(list);
  }catch(e){onError(e);}
 }
 async function send(){
  if(!prompt.trim()||busy||!connected||!models.length||account?.requiresAuthentication)return;
  const text=prompt;setPrompt('');setBusy(true);
  try{
   let id=thread;
   if(!id){const r=await rpc('thread/start',{model:model||undefined});id=r.thread.id;setThread(id);threadRef.current=id;}
   setMessages(prev=>[...prev,{id:crypto.randomUUID(),role:'user',text}]);
   const input:any[]=[{type:'text',text:text+'\n\n[Studio workspace context]\n'+context}];
   if(skill)input.push({type:'skill',name:skill.name,path:skill.path});
   const r=await rpc('turn/start',{threadId:id,input,model:model||undefined,effort:effort||undefined});setTurn(r.turn.id);
  }catch(e){setBusy(false);onError(e);}
 }
 async function applyOptions(){
  setApplying(true);try{
   const preferences={contextWindow:contextWindow?Number(contextWindow):undefined,compactLimit:compactLimit?Number(compactLimit):undefined,effort};
   if(connected){const result=await invoke('agent.configure',{provider:providerRef.current,preferences,threadId:thread,model:model||undefined});if(result.thread){setThread(result.thread.id);threadRef.current=result.thread.id;}setConnected(true);}
   else await invoke('settings',{agent:preferences});
   setUsage(null);setApplied(t('已应用；实际窗口以服务回报为准'));
  }catch(e){onError(e);}finally{setApplying(false);}
 }
 async function respond(request:RpcEvent,result:any){
  try{await invoke('agent.respond',{provider:providerRef.current,id:request.id,result});setRequests(prev=>prev.filter(r=>r.id!==request.id));}catch(e){onError(e);}
 }
 return <aside className="agent-panel" style={{width}}>
  <div className="panel-heading"><span><Sparkles size={16}/>{tr("科研助手")}</span><button className="icon-button" title={tr("新会话")} onClick={()=>{setThread(null);threadRef.current=null;setMessages([]);setUsage(null);}} disabled={busy}><Plus size={17}/></button></div>
  <div className="agent-provider"><label>{t("服务商")}<select data-testid="agent-provider" value={provider} disabled={busy||connecting||applying} onChange={e=>void selectProvider(e.target.value as AgentProvider)}><option value="codex">Codex</option><option value="kimi">Kimi</option><option value="qwen">Qwen</option></select></label><button className="button" disabled={busy||connecting||applying} onClick={()=>setLogin(true)}>{t("登录 / 账户")}</button></div>
  <div className="agent-config">{connected?<><select value={model} disabled={busy||applying} onChange={e=>void selectModel(e.target.value)}>{!models.length&&<option value="">{t("登录后加载模型目录")}</option>}{models.map(m=><option key={m.id} value={m.model}>{m.displayName||m.model}</option>)}</select><span className="connection"><i/>{tr("已连接")}</span></>:<button className="button wide" onClick={()=>void connect()} disabled={connecting}>{connecting?<LoaderCircle className="spin" size={15}/>:<Sparkles size={15}/>}{t("连接")} {provider==='codex'?'Codex':provider==='kimi'?'Kimi':'Qwen'}</button>}</div>
  <div className="agent-controls"><label>{provider==='codex'?'Effort':t('思考设置')}<select value={effort} disabled={!connected||busy||applying} onChange={e=>setEffort(e.target.value)}>{!efforts.length&&<option value="">{t('模型默认')}</option>}{efforts.map((e:any)=><option key={e.reasoningEffort} value={e.reasoningEffort}>{e.reasoningEffort}</option>)}</select></label><button className="button" disabled={provider!=='codex'} title={provider==='codex'?t('上下文设置'):t('此提供方通过协议回报上下文，暂不支持修改预算')} onClick={()=>setOptions(!options)}><Settings2 size={14}/>{t('上下文')}</button></div>
  {options&&<div className="context-options"><label>{t('上下文预算 · tokens')}<input type="number" min={1024} placeholder={t('模型默认')} value={contextWindow} disabled={busy||applying} onChange={e=>{setContextWindow(e.target.value);setApplied('');}}/></label><label>{t('自动压缩阈值 · tokens')}<input type="number" min={1024} placeholder={t('模型默认')} value={compactLimit} disabled={busy||applying} onChange={e=>{setCompactLimit(e.target.value);setApplied('');}}/></label><p>{t('预算不会扩大模型本身的最大容量。应用后恢复当前会话，计算作业继续运行。')}</p><button className="button" disabled={busy||applying} onClick={()=>void applyOptions()}>{tr(applying?t('应用中…'):t('应用上下文设置'))}</button><small>{applied}</small></div>}
  <div className="context-usage">{usage?t("上下文")+" "+(usage.last?.totalTokens?.toLocaleString()||t("未知"))+" / "+(usage.modelContextWindow?.toLocaleString()||t("未知"))+" tokens":t("上下文用量：等待服务回报")}</div>
  {connected&&account?.requiresAuthentication&&<button className="button" onClick={()=>setLogin(true)}>{t('请先登录所选服务商')}</button>}
  {connected&&provider!=='codex'&&<div className="provider-account">{account?.modelAccess==='passed'?t('模型调用已验证'):t('模型调用尚未验证')}{account?.credentialStored?' · '+t('已保存凭据'):''}</div>}
  {connected&&threads.length>0&&<select className="thread-select" value={thread||''} onChange={e=>{if(e.target.value)void resume(e.target.value);}}><option value="">{tr("新会话")}</option>{threads.map(t=><option key={t.id} value={t.id}>{t.name||t.preview?.slice(0,35)||t.id.slice(0,12)}</option>)}</select>}
  {connected&&account?.requiresOpenaiAuth&&!account.account&&<button className="button" onClick={()=>void Promise.resolve(setLogin(true))}>{tr("登录 ChatGPT 账户")}</button>}
  <div className="chat-scroll" ref={scroll}>
   {!messages.length&&<div className="agent-welcome"><div className="agent-orb"><Sparkles size={24}/></div><h3>{tr("让想法进入计算")}</h3><p>{tr("定义实验、准备输入、运行计算，")}<br/>{tr("然后一起检查结果。")}</p><div className="prompt-hints">{['检查我的计算环境','帮我设计一个 pyGAS bias','分析选中任务的运行日志'].map(t=><button key={t} onClick={()=>setPrompt(t)}>{tr(t)}<ArrowUp size={13}/></button>)}</div><small>{tr("科学参数会显式记录；作业状态来自真实进程。")}</small></div>}
   {messages.map(m=><div key={m.id} className={'message '+m.role}>{m.role==='tool'?<details><summary><Check size={13}/>{m.text.split('\n')[0]}</summary><pre>{m.text}</pre></details>:<><div className="message-role">{tr(m.role==='user'?'你':'GPU Sampling Studio')}</div><div className="message-text">{m.text}</div></>}{m.runId&&<button className="tool-card" onClick={()=>onOpenRun?.(m.runId!)}>{tr("打开计算记录 ·")}{m.runId.slice(0,12)}</button>}{m.diff&&<pre className="diff-text">{m.diff}</pre>}</div>)}
   {requests.map(r=><div key={String(r.id)} className="approval"><div><Shield size={15}/>{tr("需要你的决定")}</div><p>{r.params?.reason||r.params?.message||r.method}</p>{r.params?.command&&<pre>{r.params.command}</pre>}
    {r.params?.questions?.map((q:any)=><label key={q.id}>{q.question||q.header}<input placeholder={tr("填写回答，或输入选项名称")} value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/><small>{q.options?.map((o:any)=>o.label).join(' / ')}</small></label>)}
    {r.method==='studio/question'?<div className="button-row">{r.params.questionOptions?.map((o:any)=><button className="button" key={o.optionId} onClick={()=>void respond(r,{optionId:o.optionId})}>{o.name}</button>)}<button className="button" onClick={()=>void respond(r,{})}>{t('取消')}</button></div>:r.params?.questions?<button className="button primary" onClick={()=>void respond(r,{answers:Object.fromEntries(r.params.questions.map((q:any)=>[q.id,{answers:[answers[q.id]||'']}]))})}>{tr("提交回答")}</button>:
     r.method.includes('elicitation')?<><textarea placeholder="JSON content" value={answers[String(r.id)]||'{}'} onChange={e=>setAnswers({...answers,[String(r.id)]:e.target.value})}/><div className="button-row"><button className="button primary" onClick={()=>{try{void respond(r,{action:'accept',content:JSON.parse(answers[String(r.id)]||'{}')});}catch(e){onError(e);}}}>{tr("接受")}</button><button className="button" onClick={()=>void respond(r,{action:'decline',content:null})}>{tr("拒绝")}</button></div></>:
     r.method.includes('permissions')?<><pre>{JSON.stringify(r.params?.permissions,null,2)}</pre><div className="button-row"><button className="button primary" onClick={()=>void respond(r,{permissions:r.params?.permissions,scope:"turn"})}>{tr("本轮允许所示权限")}</button><button className="button" onClick={()=>void respond(r,{permissions:{},scope:"turn"})}>{tr("拒绝权限请求")}</button></div></>:
     <div className="button-row"><button className="button primary" onClick={()=>void respond(r,{decision:'accept'})}>{tr("允许一次")}</button><button className="button" onClick={()=>void respond(r,{decision:'acceptForSession'})}>{tr("会话内允许")}</button><button className="button" onClick={()=>void respond(r,{decision:'decline'})}>{tr("拒绝")}</button></div>}
   </div>)}
   {busy&&<div className="thinking"><LoaderCircle size={14} className="spin"/>{tr("Agent 正在工作")}</div>}
  </div>
  <div className="composer">{skill&&<span className="skill-chip">$ {skill.name}</span>}<textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={t(connected?'描述计算目标，或询问选中任务…':'连接服务商后开始协作…')} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}}/><div className="composer-bottom"><span>{tr(thread?thread.slice(0,12):'项目上下文已附加')}</span>{busy?<button className="send" title={tr("中断 Agent，计算作业继续")} onClick={()=>void rpc('turn/interrupt',{threadId:thread,turnId:turn}).catch(onError)}><Square size={13}/></button>:<button className="send" onClick={()=>void send()} disabled={!connected||!models.length||account?.requiresAuthentication||!prompt.trim()}><ArrowUp size={17}/></button>}</div></div>
  <div className="agent-footer">{tr("Agent 会话与科学计算队列独立运行")}</div>
  {login&&<ProviderLogin provider={provider} onClose={()=>setLogin(false)} onConfigured={()=>{if(provider!=='codex'){setLogin(false);void connect();}}} onError={onError}/>}
 </aside>;
}
