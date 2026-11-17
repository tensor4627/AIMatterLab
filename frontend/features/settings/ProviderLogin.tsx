import {useEffect,useRef,useState} from 'react';
import {LogIn,ExternalLink,LoaderCircle,KeyRound,CheckCircle2} from 'lucide-react';
import {Modal} from "../../ui/Dialogs";
import {invoke} from '../../api/studio';
import {type AgentProvider} from '../../../contracts/dto/agent';
import {t} from "../../ui/i18n";
import LoadingFeedback from '../../ui/LoadingFeedback';
import CliRuntimeDialog from './CliRuntimeDialog';
import {cliRuntime} from '../../api/cli-runtime';
import type {CliReadiness} from '../../../contracts/dto/cli-runtime';
import ModelProviders from './ModelProviders';
import type {CancelProviderLoginRequest} from '../../../contracts/dto/agent';
const loginPhases:Record<string,string>={starting:'正在准备登录',authorizing:'等待授权',completed:'已登录',failed:'登录失败',cancelled:'已取消登录',signed_out:'尚未登录'};
export default function ProviderLogin(props:Parameters<typeof LegacyProviderLogin>[0]){if(props.provider==='qwen'||props.provider==='compatible')return props.embedded?<ModelProviders provider={props.provider} disabled={props.disabled} onError={props.onError} onConfigured={props.onConfigured}/>:<Modal title={t('模型与 API')} onClose={props.onClose}><ModelProviders provider={props.provider} disabled={props.disabled} onError={props.onError} onConfigured={props.onConfigured}/></Modal>;return <LegacyProviderLogin {...props}/>;}
function LegacyProviderLogin({provider,onClose,onConfigured,onError,embedded=false,disabled=false}:{projectId?:string;embedded?:boolean;disabled?:boolean;provider:AgentProvider;onClose:()=>void;onConfigured:()=>void;onError:(e:unknown)=>void}){
 const [confirmRemove,setConfirmRemove]=useState(false),[baseUrl,setBaseUrl]=useState(''),[apiLabel,setApiLabel]=useState('');
 const [sharePublicGuides,setSharePublicGuides]=useState(false),[sharingTouched,setSharingTouched]=useState(false);
 const [reasoningMode,setReasoningMode]=useState('omit'),[reasoningEffort,setReasoningEffort]=useState('');
 const [testing,setTesting]=useState(false),[testResult,setTestResult]=useState('');
 const [status,setStatus]=useState<any>({}),[busy,setBusy]=useState(false),[region,setRegion]=useState('mainland-cn'),[key,setKey]=useState(''),[plan,setPlan]=useState('coding-cn'),[method,setMethod]=useState('chatgpt'),[codexKey,setCodexKey]=useState(''),[model,setModel]=useState(provider==='compatible'?'':'qwen3-coder-plus');
 const [dirty,setDirty]=useState(false),[accountLoaded,setAccountLoaded]=useState(false),[accountError,setAccountError]=useState(false);
 const lifecycle=useRef(0),revision=useRef(0),operation=useRef(false);
 const loginEvents=useRef(0);
 const [cancelling,setCancelling]=useState(false),[removing,setRemoving]=useState(false);
 const [runtimePrompt,setRuntimePrompt]=useState<CliReadiness|null>(null),[accountRefreshing,setAccountRefreshing]=useState(false);
 const accountSequence=useRef(0),accountFlight=useRef<{epoch:number;promise:Promise<void>}|null>(null);
 const apiProvider=provider==='compatible'||provider==='deepseek';
 function changed(){revision.current++;setDirty(true);setTestResult('');}
 function refreshAccount():Promise<void>{
  if(operation.current)return Promise.resolve();
  const epoch=lifecycle.current;if(accountFlight.current?.epoch===epoch)return accountFlight.current.promise;
  const seq=++accountSequence.current,submittedRevision=revision.current,current=()=>epoch===lifecycle.current&&seq===accountSequence.current;setAccountRefreshing(true);
  const promise=invoke('agent.account',{provider}).then(value=>{if(!current())return;setStatus(value);setAccountLoaded(true);setAccountError(false);if(provider==='compatible'&&!dirty&&submittedRevision===revision.current){setReasoningMode(value.reasoningMode||'omit');setReasoningEffort(value.reasoningEffort||'');setBaseUrl(value.baseUrl||'');setModel(value.model||'');setApiLabel(value.label||'');setSharePublicGuides(value.publicGuidesAllowed===true);}if(!operation.current)setBusy(['starting','authorizing'].includes(value.phase));}).catch(error=>{if(current()){setAccountError(true);onError(error);}}).finally(()=>{if(current()){accountFlight.current=null;setAccountRefreshing(false);}});
  accountFlight.current={epoch,promise};return promise;
 }
 useEffect(()=>{
  const epoch=++lifecycle.current;accountFlight.current=null;setAccountLoaded(false);setAccountError(false);setRuntimePrompt(null);void refreshAccount();
  const off=window.studio?.onEvent(event=>{
    if(epoch===lifecycle.current&&event.method==='studio/login'&&event.provider===provider){loginEvents.current++;accountSequence.current++;accountFlight.current=null;setAccountRefreshing(false);setStatus(event.params);setBusy(['starting','authorizing'].includes(event.params.phase));if(event.params.phase==='completed'){void refreshAccount().then(()=>{if(epoch===lifecycle.current)onConfigured();});}}
  });
  return()=>{off?.();lifecycle.current++;accountSequence.current++;accountFlight.current=null;operation.current=false;};
 },[provider]);
 async function start(){
  if(disabled||operation.current||busy||testing)return;const epoch=lifecycle.current,submittedRevision=revision.current;operation.current=true;setBusy(true);setTestResult('');
  try{
   if(provider==='kimi'||provider==='qwen'){const readiness=await cliRuntime.inspect(provider);if(epoch!==lifecycle.current)return;if(readiness.status!=='ready'){setRuntimePrompt(readiness);setBusy(false);return;}}
   accountSequence.current++;accountFlight.current=null;setAccountRefreshing(false);
   const eventAtStart=loginEvents.current;
   if(provider==='codex'||provider==='kimi')setStatus((previous:any)=>({...previous,phase:'starting',message:'',url:undefined,userCode:undefined}));
   const result=await invoke('agent.login',provider==='compatible'?{provider,apiKey:key,baseUrl,model,reasoningMode,reasoningEffort,label:apiLabel,...sharingTouched?{sharePublicGuides}:{}}:provider==='deepseek'?{provider,apiKey:key}:provider==='qwen'?{provider,apiKey:key,plan,model}:provider==='codex'?{provider,type:method,...method==='apiKey'?{apiKey:codexKey}:{}}:{provider,region});
   if(epoch!==lifecycle.current)return;
   if(submittedRevision===revision.current){setDirty(false);setSharingTouched(false);}
   setKey('');setCodexKey('');
   if(loginEvents.current!==eventAtStart)return;
   setStatus(result);
   if(result.phase==='failed'||result.phase==='cancelled')setBusy(false);
   if(provider==='qwen'||provider==='deepseek'||provider==='compatible'||provider==='codex'&&result.phase==='completed'){setBusy(false);onConfigured();}
  }catch(e){if(epoch===lifecycle.current){setBusy(false);if(provider==='codex')setStatus({phase:'failed',message:e instanceof Error?e.message:String(e)});else onError(e);}}finally{if(epoch===lifecycle.current)operation.current=false;}
 }
 async function testConnection(){
  if(disabled||operation.current||busy||testing||dirty||!accountLoaded)return;
  const epoch=lifecycle.current,submittedRevision=revision.current,current=()=>epoch===lifecycle.current&&submittedRevision===revision.current;
  operation.current=true;setTesting(true);setTestResult('');
  try{const result=await invoke('agent.testConnection',{provider});if(!current())return;const account=await invoke('agent.account',{provider});if(!current())return;setTestResult(t('测试调用成功')+' · '+result.model);setStatus(account);}catch(error){if(current())setTestResult(error instanceof Error?error.message:String(error));}finally{if(epoch===lifecycle.current){operation.current=false;setTesting(false);}}
 }
 async function cancelCodex(){
  if(operation.current||disabled||!status.loginId)return;
  const epoch=lifecycle.current,eventAtStart=loginEvents.current;operation.current=true;setCancelling(true);
  try{const result=await invoke('agent.login.cancel',{provider:'codex',loginId:status.loginId} satisfies CancelProviderLoginRequest);if(epoch===lifecycle.current&&eventAtStart===loginEvents.current){setStatus(result);setBusy(result.phase==='authorizing');}}
  catch(error){if(epoch===lifecycle.current)onError(error);}
  finally{if(epoch===lifecycle.current){operation.current=false;setCancelling(false);}}
 }
 async function remove(){if(disabled||operation.current||busy||testing)return;const epoch=lifecycle.current;operation.current=true;accountSequence.current++;accountFlight.current=null;setAccountRefreshing(false);setBusy(true);setRemoving(true);setTestResult('');try{const result=await invoke('agent.logout',{provider});if(epoch===lifecycle.current){setStatus(result);setConfirmRemove(false);}}catch(error){if(epoch===lifecycle.current){setAccountError(true);onError(error);}}finally{if(epoch===lifecycle.current){operation.current=false;setBusy(false);setRemoving(false);}}}
 const accountSummary=status.account?.email||status.account?.type||(status.credentialStored?t('已保存 API 凭据'):
  status.phase?t(loginPhases[status.phase]||status.phase):provider==='codex'&&status.requiresOpenaiAuth===true?t('尚未登录'):t('等待认证状态'));
 const content=<fieldset className="account-login-fields" onChangeCapture={changed} disabled={disabled||apiProvider&&(busy||testing)} style={{border:0,padding:0,margin:0,minWidth:0}}>
  <div className="provider-login"><div className="account-summary"><strong>{t('实际账户状态')}</strong><span>{accountSummary}</span><small>{t('模型访问')} · {status.modelAccess||'not_run'}</small><button className="button" disabled={accountRefreshing||busy||testing} onClick={()=>void refreshAccount()}>{t('刷新账户状态')}</button></div>
   <LoadingFeedback busy={accountRefreshing} label={t('正在读取账户状态')}/>
   {provider!=='codex'&&<LoadingFeedback busy={busy||testing} label={t(testing?'正在验证 API 连接':provider==='kimi'?'正在等待 Kimi 登录':'正在保存账户配置')}/>}
   {(provider==='kimi'||provider==='qwen')&&testResult&&<p role="status">{testResult}</p>}
   {accountError&&<p role="alert">{t('账户状态读取失败，请刷新账户状态后重试。')}</p>}
   {provider==='codex'&&<>
    <p>{t('使用现有 ChatGPT 账户，在官方浏览器页面完成登录。')}</p>
    <label>{t('登录方式')}<select value={method} disabled={busy} onChange={e=>setMethod(e.target.value)}><option value="chatgpt">{t('ChatGPT 浏览器登录')}</option><option value="chatgptDeviceCode">{t('ChatGPT 设备码登录')}</option><option value="apiKey">OpenAI API Key</option></select></label>
    {method==='apiKey'&&<label>API Key<input type="password" autoComplete="off" value={codexKey} onChange={e=>setCodexKey(e.target.value)}/></label>}
    <div className="button-row"><button className="button primary" onClick={()=>void start()} disabled={busy||method==='apiKey'&&!codexKey}><LogIn size={15}/>{t(status.phase==='failed'||status.phase==='cancelled'?'重新登录':'开始登录')}</button>
     {status.phase==='authorizing'&&status.loginId&&<button className="button" disabled={cancelling} onClick={()=>void cancelCodex()}>{t('取消登录')}</button>}
    </div>
    <LoadingFeedback busy={busy} label={t(removing?'正在退出登录':cancelling?'正在取消登录':status.phase==='authorizing'?'请在浏览器完成授权':'正在准备登录')}/>
    {status.userCode&&<div className="device-code">{status.userCode}</div>}
    {status.url&&<button className="button" onClick={()=>void invoke('agent.login.open',{provider}).catch(onError)}>{t('打开官方授权页面')}</button>}
    {status.phase==='failed'&&<p role="alert">{status.message?t(status.message):t('登录失败，请重新登录。')}</p>}
    <p className="muted">{t('完成授权后自动刷新账户和模型目录。')}</p>
   </>}
   {provider==='kimi'&&<>
    <p>{t('使用 Kimi Code 官方设备授权。账户凭据保存在本应用独立的 CLI 配置中。')}</p>
    <label>{t('账户地区')}<select value={region} disabled={busy} onChange={e=>setRegion(e.target.value)}><option value="mainland-cn">{t('中国大陆 · kimi.com')}</option><option value="global">{t('国际 · kimi.ai')}</option></select></label>
    <button className="button primary" onClick={()=>void start()} disabled={busy}>{busy?<LoaderCircle size={15} className="spin"/>:<LogIn size={15}/>}{t('开始 Kimi 登录')}</button>
    {status.url&&<><div className="notice">{t('在授权页面输入下方终端显示的验证码。')}</div><button className="button" onClick={()=>void invoke('agent.login.open',{provider}).catch(onError)}><ExternalLink size={15}/>{t('打开官方授权页面')}</button></>}
    {status.message&&<pre className="login-output">{status.message}</pre>}
    {busy&&<button className="button" onClick={()=>void invoke('agent.login.cancel',{provider:'kimi'} satisfies CancelProviderLoginRequest).catch(onError)}>{t('取消登录')}</button>}
    {status.phase==='completed'&&<button className="button primary" onClick={onConfigured}><CheckCircle2 size={15}/>{t('登录完成，连接 Kimi')}</button>}
   </>}
   {provider==='compatible'&&<><p>{t('接入支持 Chat Completions、SSE 和工具调用的 OpenAI 兼容接口。')}</p><label>{t('服务名称')}<input value={apiLabel} onChange={e=>setApiLabel(e.target.value)} placeholder="My API"/></label><label>Base URL<input data-testid="compatible-base-url" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://example.com/v1"/></label><label>API Key<small>{t('同一服务地址留空可保留已保存密钥')}</small><input type="password" autoComplete="off" data-testid="compatible-api-key" value={key} onChange={e=>setKey(e.target.value)}/></label><label>{t('模型 ID')}<input data-testid="compatible-model" value={model} onChange={e=>setModel(e.target.value)}/></label><p className="muted">{t('无需模型发现接口，模型名按服务商文档手填。')}</p><label>{t('推理参数')}<select aria-label={t('推理参数')} value={reasoningMode} onChange={e=>setReasoningMode(e.target.value)}><option value="omit">{t('服务商默认 · 不发送')}</option><option value="reasoning_effort">reasoning_effort</option></select></label>{reasoningMode==='reasoning_effort'&&<label>{t('推理强度')}<input aria-label={t('自定义推理强度')} value={reasoningEffort} onChange={e=>setReasoningEffort(e.target.value)} placeholder="low / medium / high" list="reasoning-suggestions"/><datalist id="reasoning-suggestions">{['none','minimal','low','medium','high','xhigh','max'].map(v=><option key={v} value={v}/>)}</datalist><small>{t('仅填写此 API 支持的值；不支持时选择不发送。')}</small></label>}<label className="check-label"><input type="checkbox" checked={sharePublicGuides} onChange={e=>{setSharingTouched(true);setSharePublicGuides(e.target.checked);}}/>{t('允许向此 API 发送公开科学软件指南，不包括私有 CV、凭据或其他研究文件。')}</label><button className="button primary" disabled={busy||testing||!accountLoaded||!baseUrl||!model} onClick={()=>void start()}>{t('保存 API 配置')}</button><p className="muted">{t('模型 ID 由你指定，成功调用前标为待验证。更换地址不会把旧对话发送给新服务。')}</p></>}
   {provider==='deepseek'&&<>
    <p>{t('使用 DeepSeek 开放平台 API Key，无需安装 CLI。')}</p>
    <label>{t('官方 API 地址')}<input value="https://api.deepseek.com" readOnly/></label>
    <label>DeepSeek API Key<input data-testid="deepseek-api-key" type="password" autoComplete="off" value={key} disabled={busy} onChange={e=>setKey(e.target.value)} placeholder="sk-…"/></label>
    <button className="button primary" disabled={busy||testing||!key} onClick={()=>void start()}>{busy?<LoaderCircle size={15} className="spin"/>:<KeyRound size={15}/>} {t('保存凭据并连接')}</button>
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
  {['deepseek','compatible'].includes(provider)&&status.credentialStored&&<div><button className="button" data-testid="test-api-connection" disabled={busy||testing||dirty||!accountLoaded} onClick={()=>void testConnection()}>{t(testing?'测试连接中…':'验证 API 连接')}</button>{dirty&&<p role="status">{t('配置有未保存修改；保存后验证当前配置。')}</p>}{testResult&&<p role="status">{testResult}</p>}</div>}
  {((provider==='codex'&&status.account)||(['qwen','deepseek','compatible'].includes(provider)&&status.credentialStored))&&<div className="account-remove"><button className="button" disabled={busy||testing} onClick={()=>setConfirmRemove(true)}>{t(provider==='codex'?'退出 Codex 登录':'移除 API 凭据')}</button>{confirmRemove&&<div className="notice" role="alert"><p>{t(provider==='codex'?'退出 AIMatterLab 的 Codex 登录；本机 Codex 的登录、对话和计算记录保留。':'移除本机保存的密钥；对话和计算记录保留，不会撤销平台上的密钥。')}</p><button className="button" onClick={()=>setConfirmRemove(false)}>{t('取消')}</button><button className="button" disabled={busy||testing} onClick={()=>void remove()}>{t('确认移除')}</button></div>}</div>}
  </div>
 </fieldset>;
 return <>{embedded?content:<Modal title={t('服务商登录')+' · '+(provider==='codex'?'Codex':provider==='kimi'?'Kimi':provider==='deepseek'?'DeepSeek API':provider==='compatible'?t('自定义 API'):'Qwen')} onClose={onClose}>{content}</Modal>}{runtimePrompt&&(provider==='kimi'||provider==='qwen')&&<CliRuntimeDialog provider={provider} readiness={runtimePrompt} onClose={()=>setRuntimePrompt(null)} onReady={()=>{setRuntimePrompt(null);setTestResult(t('CLI 已就绪，请继续登录。'));}}/>}</>;
}
