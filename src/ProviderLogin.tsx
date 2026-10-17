import {useEffect,useState} from 'react';
import {LogIn,ExternalLink,LoaderCircle,KeyRound,CheckCircle2} from 'lucide-react';
import {Modal} from './Dialogs';
import {invoke,type AgentProvider} from './types';
import {t} from './i18n';
export default function ProviderLogin({provider,onClose,onConfigured,onError,projectId}:{projectId?:string;provider:AgentProvider;onClose:()=>void;onConfigured:()=>void;onError:(e:unknown)=>void}){
 const [status,setStatus]=useState<any>({}),[busy,setBusy]=useState(false),[region,setRegion]=useState('mainland-cn'),[key,setKey]=useState(''),[plan,setPlan]=useState('coding-cn'),[method,setMethod]=useState('chatgpt'),[codexKey,setCodexKey]=useState(''),[model,setModel]=useState('qwen3-coder-plus');
 useEffect(()=>{
  void invoke('agent.account',{provider}).then(value=>{setStatus(value);setBusy(['starting','authorizing'].includes(value.phase));}).catch(onError);
  return window.studio?.onEvent(event=>{
   if(event.method==='studio/login'&&event.provider===provider){setStatus(event.params);setBusy(['starting','authorizing'].includes(event.params.phase));if(event.params.phase==='completed'){void invoke('agent.account',{provider}).then(setStatus).catch(onError);if(projectId)void invoke('agent.bindProject',{projectId,provider}).catch(onError);onConfigured();}}
  });
 },[provider]);
 async function start(){
  setBusy(true);
  try{
   const result=await invoke('agent.login',provider==='deepseek'?{provider,apiKey:key}:provider==='qwen'?{provider,apiKey:key,plan,model}:provider==='codex'?{provider,type:method,...method==='apiKey'?{apiKey:codexKey}:{}}:{provider,region});
   setKey('');setCodexKey('');if(projectId)await invoke('agent.bindProject',{projectId,provider});setStatus((previous:any)=>provider==='kimi'&&['authorizing','completed','failed','cancelled'].includes(previous.phase)?previous:result);
   if(provider==='qwen'||provider==='deepseek'||provider==='codex'&&result.phase==='completed'){setBusy(false);onConfigured();}
  }catch(e){setBusy(false);onError(e);}
 }
 return <Modal title={t('服务商登录')+' · '+(provider==='codex'?'Codex':provider==='kimi'?'Kimi':provider==='deepseek'?'DeepSeek API':'Qwen')} onClose={onClose}>
  <div className="provider-login"><div className="account-summary"><strong>{t('实际账户状态')}</strong><span>{status.account?.email||status.account?.type||(status.credentialStored?t('已保存 API 凭据'):status.phase||t('等待认证状态'))}</span><small>{t('模型访问')} · {status.modelAccess||'not_run'}</small><button className="button" onClick={()=>void invoke('agent.account',{provider}).then(setStatus).catch(onError)}>{t('刷新账户状态')}</button>{projectId&&<button className="button" onClick={()=>void invoke('agent.bindProject',{projectId,provider}).then(()=>onConfigured()).catch(onError)}>{t('设为当前项目服务商')}</button>}</div>
   {provider==='codex'&&<><p>{t('使用现有 ChatGPT 账户，在官方浏览器页面完成登录。')}</p><label>{t('登录方式')}<select value={method} disabled={busy} onChange={e=>setMethod(e.target.value)}><option value="chatgpt">{t('ChatGPT 浏览器登录')}</option><option value="chatgptDeviceCode">{t('ChatGPT 设备码登录')}</option><option value="apiKey">OpenAI API Key</option></select></label>{method==='apiKey'&&<label>API Key<input type="password" autoComplete="off" value={codexKey} onChange={e=>setCodexKey(e.target.value)}/></label>}<button className="button primary" onClick={()=>void start()} disabled={busy||method==='apiKey'&&!codexKey}><LogIn size={15}/>{t('开始登录')}</button>{status.userCode&&<div className="device-code">{status.userCode}</div>}{status.url&&<button className="button" onClick={()=>void invoke('agent.login.open',{provider}).catch(onError)}>{t('打开官方授权页面')}</button>}<p className="muted">{t('完成授权后自动刷新账户和模型目录。')}</p></>}
   {provider==='kimi'&&<>
    <p>{t('使用 Kimi Code 官方设备授权。账户凭据保存在本应用独立的 CLI 配置中。')}</p>
    <label>{t('账户地区')}<select value={region} disabled={busy} onChange={e=>setRegion(e.target.value)}><option value="mainland-cn">{t('中国大陆 · kimi.com')}</option><option value="global">{t('国际 · kimi.ai')}</option></select></label>
    <button className="button primary" onClick={()=>void start()} disabled={busy}>{busy?<LoaderCircle size={15} className="spin"/>:<LogIn size={15}/>}{t('开始 Kimi 登录')}</button>
    {status.url&&<><div className="notice">{t('在授权页面输入下方终端显示的验证码。')}</div><button className="button" onClick={()=>void invoke('agent.login.open',{provider}).catch(onError)}><ExternalLink size={15}/>{t('打开官方授权页面')}</button></>}
    {status.message&&<pre className="login-output">{status.message}</pre>}
    {busy&&<button className="button" onClick={()=>void invoke('agent.login.cancel').catch(onError)}>{t('取消登录')}</button>}
    {status.phase==='completed'&&<button className="button primary" onClick={onConfigured}><CheckCircle2 size={15}/>{t('登录完成，连接 Kimi')}</button>}
   </>}
   {provider==='deepseek'&&<>
    <p>{t('使用 DeepSeek 开放平台 API Key，无需安装 CLI。')}</p>
    <label>{t('官方 API 地址')}<input value="https://api.deepseek.com" readOnly/></label>
    <label>DeepSeek API Key<input data-testid="deepseek-api-key" type="password" autoComplete="off" value={key} disabled={busy} onChange={e=>setKey(e.target.value)} placeholder="sk-…"/></label>
    <button className="button primary" disabled={busy||!key} onClick={()=>void start()}>{busy?<LoaderCircle size={15} className="spin"/>:<KeyRound size={15}/>} {t('保存凭据并连接')}</button>
    <p className="muted">{t('密钥由主进程使用系统加密保存。模型是否可用以实际调用为准。')}</p>
    <p className="muted">{t('连接后读取账户模型目录，默认关闭思考以减少等待；也可切换思考强度。')}</p>
    {status.credentialStored&&<div className="notice">{t('已有加密凭据，可关闭此窗口直接连接。')}</div>}
   </>}
   {provider==='qwen'&&<>
    <p>{t('Qwen 当前使用百炼 API Key 或 Coding Plan；旧 OAuth 免费登录已停止。')}</p>
    <label>{t('服务与地区')}<select value={plan} onChange={e=>setPlan(e.target.value)}><option value="coding-cn">{t('Coding Plan · 中国大陆')}</option><option value="coding-intl">{t('Coding Plan · 国际')}</option><option value="api-cn">{t('按量 API · 中国大陆')}</option><option value="api-intl">{t('按量 API · 国际')}</option></select></label>
    <label>API Key<input data-testid="qwen-api-key" type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder={plan.startsWith('coding')?'sk-sp-…':'sk-…'}/></label>
    <label>{t('模型 ID')}<input value={model} onChange={e=>setModel(e.target.value)} placeholder="qwen3-coder-plus"/></label>
    <button className="button primary" disabled={busy||!key||!model} onClick={()=>void start()}><KeyRound size={15}/>{t('保存凭据并连接')}</button>
    <p className="muted">{t('密钥由主进程使用系统加密保存。模型是否可用以实际调用为准。')}</p>
    {status.credentialStored&&<div className="notice">{t('已有加密凭据，可关闭此窗口直接连接。')}</div>}
   </>}
  </div>
 </Modal>;
}
