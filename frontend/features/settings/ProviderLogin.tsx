import {useEffect,useState} from 'react';
import {LogIn,ExternalLink,LoaderCircle,KeyRound,CheckCircle2} from 'lucide-react';
import {Modal} from "../../ui/Dialogs";
import {invoke} from '../../api/studio';
import {type AgentProvider} from '../../../contracts/dto/agent';
import {t} from "../../ui/i18n";
export default function ProviderLogin({provider,onClose,onConfigured,onError,embedded=false,disabled=false}:{projectId?:string;embedded?:boolean;disabled?:boolean;provider:AgentProvider;onClose:()=>void;onConfigured:()=>void;onError:(e:unknown)=>void}){
 const [confirmRemove,setConfirmRemove]=useState(false),[baseUrl,setBaseUrl]=useState(''),[apiLabel,setApiLabel]=useState('');
 const [sharePublicGuides,setSharePublicGuides]=useState(false),[sharingTouched,setSharingTouched]=useState(false);
 const [reasoningMode,setReasoningMode]=useState('omit'),[reasoningEffort,setReasoningEffort]=useState('');
 const [testing,setTesting]=useState(false),[testResult,setTestResult]=useState('');
 const [status,setStatus]=useState<any>({}),[busy,setBusy]=useState(false),[region,setRegion]=useState('mainland-cn'),[key,setKey]=useState(''),[plan,setPlan]=useState('coding-cn'),[method,setMethod]=useState('chatgpt'),[codexKey,setCodexKey]=useState(''),[model,setModel]=useState(provider==='compatible'?'':'qwen3-coder-plus');
 useEffect(()=>{
  void invoke('agent.account',{provider}).then(value=>{setStatus(value);if(provider==='compatible'){setReasoningMode(value.reasoningMode||'omit');setReasoningEffort(value.reasoningEffort||'');setBaseUrl(value.baseUrl||'');setModel(value.model||'');setApiLabel(value.label||'');setSharePublicGuides(value.publicGuidesAllowed===true);}setBusy(['starting','authorizing'].includes(value.phase));}).catch(onError);
  return window.studio?.onEvent(event=>{
   if(event.method==='studio/login'&&event.provider===provider){setStatus(event.params);setBusy(['starting','authorizing'].includes(event.params.phase));if(event.params.phase==='completed'){void invoke('agent.account',{provider}).then(setStatus).catch(onError);onConfigured();}}
  });
 },[provider]);
 async function start(){
  if(disabled)return;setBusy(true);
  try{
   const result=await invoke('agent.login',provider==='compatible'?{provider,apiKey:key,baseUrl,model,reasoningMode,reasoningEffort,label:apiLabel,...sharingTouched?{sharePublicGuides}:{}}:provider==='deepseek'?{provider,apiKey:key}:provider==='qwen'?{provider,apiKey:key,plan,model}:provider==='codex'?{provider,type:method,...method==='apiKey'?{apiKey:codexKey}:{}}:{provider,region});
   setKey('');setCodexKey('');setStatus((previous:any)=>provider==='kimi'&&['authorizing','completed','failed','cancelled'].includes(previous.phase)?previous:result);
   if(provider==='qwen'||provider==='deepseek'||provider==='compatible'||provider==='codex'&&result.phase==='completed'){setBusy(false);onConfigured();}
  }catch(e){setBusy(false);onError(e);}
 }
 const content=<fieldset className="account-login-fields" disabled={disabled} style={{border:0,padding:0,margin:0,minWidth:0}}>
  <div className="provider-login"><div className="account-summary"><strong>{t('实际账户状态')}</strong><span>{status.account?.email||status.account?.type||(status.credentialStored?t('已保存 API 凭据'):status.phase||t('等待认证状态'))}</span><small>{t('模型访问')} · {status.modelAccess||'not_run'}</small><button className="button" onClick={()=>void invoke('agent.account',{provider}).then(setStatus).catch(onError)}>{t('刷新账户状态')}</button></div>
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
   {provider==='compatible'&&<><p>{t('接入支持 Chat Completions、SSE 和工具调用的 OpenAI 兼容接口。')}</p><label>{t('服务名称')}<input value={apiLabel} onChange={e=>setApiLabel(e.target.value)} placeholder="My API"/></label><label>Base URL<input data-testid="compatible-base-url" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://example.com/v1"/></label><label>API Key<small>{t('同一服务地址留空可保留已保存密钥')}</small><input type="password" autoComplete="off" data-testid="compatible-api-key" value={key} onChange={e=>setKey(e.target.value)}/></label><label>{t('模型 ID')}<input data-testid="compatible-model" value={model} onChange={e=>setModel(e.target.value)}/></label><p className="muted">{t('无需模型发现接口，模型名按服务商文档手填。')}</p><label>{t('推理参数')}<select aria-label={t('推理参数')} value={reasoningMode} onChange={e=>setReasoningMode(e.target.value)}><option value="omit">{t('服务商默认 · 不发送')}</option><option value="reasoning_effort">reasoning_effort</option></select></label>{reasoningMode==='reasoning_effort'&&<label>{t('推理强度')}<input aria-label={t('自定义推理强度')} value={reasoningEffort} onChange={e=>setReasoningEffort(e.target.value)} placeholder="low / medium / high" list="reasoning-suggestions"/><datalist id="reasoning-suggestions">{['none','minimal','low','medium','high','xhigh','max'].map(v=><option key={v} value={v}/>)}</datalist><small>{t('仅填写此 API 支持的值；不支持时选择不发送。')}</small></label>}<label className="check-label"><input type="checkbox" checked={sharePublicGuides} onChange={e=>{setSharingTouched(true);setSharePublicGuides(e.target.checked);}}/>{t('允许向此 API 发送公开科学软件指南，不包括私有 CV、凭据或其他研究文件。')}</label><button className="button primary" disabled={busy||!baseUrl||!model} onClick={()=>void start()}>{t('保存 API 配置')}</button><p className="muted">{t('模型 ID 由你指定，成功调用前标为待验证。更换地址不会把旧对话发送给新服务。')}</p></>}
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
  {['deepseek','compatible'].includes(provider)&&status.credentialStored&&<div><button className="button" data-testid="test-api-connection" disabled={busy||testing} onClick={async()=>{setTesting(true);setTestResult('');try{const result=await invoke('agent.testConnection',{provider});setTestResult(t('测试调用成功')+' · '+result.model);setStatus(await invoke('agent.account',{provider}));}catch(error){setTestResult(error instanceof Error?error.message:String(error));}finally{setTesting(false);}}}>{t(testing?'测试连接中…':'验证 API 连接')}</button>{testResult&&<p role="status">{testResult}</p>}</div>}
  {((provider==='codex'&&status.account)||(['qwen','deepseek','compatible'].includes(provider)&&status.credentialStored))&&<div className="account-remove"><button className="button" disabled={busy||testing} onClick={()=>setConfirmRemove(true)}>{t(provider==='codex'?'退出 Codex 登录':'移除 API 凭据')}</button>{confirmRemove&&<div className="notice" role="alert"><p>{t(provider==='codex'?'退出将影响共享此登录的本机 Codex；对话和计算记录保留。':'移除本机保存的密钥；对话和计算记录保留，不会撤销平台上的密钥。')}</p><button className="button" onClick={()=>setConfirmRemove(false)}>{t('取消')}</button><button className="button" onClick={async()=>{setBusy(true);try{setStatus(await invoke('agent.logout',{provider}));setConfirmRemove(false);}catch(error){onError(error);}finally{setBusy(false);}}}>{t('确认移除')}</button></div>}</div>}
  </div>
 </fieldset>;
 return embedded?content:<Modal title={t('服务商登录')+' · '+(provider==='codex'?'Codex':provider==='kimi'?'Kimi':provider==='deepseek'?'DeepSeek API':provider==='compatible'?t('自定义 API'):'Qwen')} onClose={onClose}>{content}</Modal>;
}
