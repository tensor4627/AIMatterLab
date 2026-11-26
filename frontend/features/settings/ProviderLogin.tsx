import {useEffect,useId,useRef,useState} from 'react';
import {LogIn,ExternalLink,KeyRound,CheckCircle2} from 'lucide-react';
import {Modal} from "../../ui/Dialogs";
import {ConfirmDialog} from '../../ui/ConfirmDialog';
import {statusLabel} from '../../ui/StatusBadge';
import Notice from '../../ui/Notice';
import {InlineDiagnostic} from '../diagnostics/DiagnosticNotice';
import {redactTranscriptText} from '../../../contracts/agent/transcript-sanitizer.mjs';
import {invoke} from '../../api/studio';
import {type AgentProvider} from '../../../contracts/dto/agent';
import {t} from "../../ui/i18n";
import {LoadingState} from '../../ui/States';
import Button from '../../ui/Button';
import {useToast} from '../../ui/Toast';
import CliRuntimeDialog from './CliRuntimeDialog';
import {cliRuntime} from '../../api/cli-runtime';
import type {CliReadiness} from '../../../contracts/dto/cli-runtime';
import ModelProviders from './ModelProviders';
import type {CancelProviderLoginRequest} from '../../../contracts/dto/agent';
import {HelpTip} from '../../ui/Tooltip';
import {providerAccountState,type AccountConfiguration} from '../conversations/provider-account.mjs';
import AccountDialogContent from './AccountDialogContent';
import './accounts.css';
const loginPhases:Record<string,string>={starting:'正在准备登录',authorizing:'等待授权',completed:'已登录',failed:'登录失败',cancelled:'已取消登录',signed_out:'尚未登录'};
type AccountProps={
 projectId?:string;embedded?:boolean;disabled?:boolean;showExit?:boolean;provider:AgentProvider;
 onClose:()=>void;onConfigured:()=>void;onTested?:(model:string)=>void;
 onAccountState?:(state:AccountConfiguration)=>void;onError:(e:unknown)=>void;
};
export default function ProviderLogin(props:AccountProps){
 if(props.provider==='qwen'||props.provider==='compatible'){
  const content=<ModelProviders provider={props.provider} disabled={props.disabled}
   onConfigured={props.onConfigured} onTested={props.onTested} onAccountState={props.onAccountState}
   onClose={!props.embedded||props.showExit?props.onClose:undefined}/>;
  return props.embedded?content:<Modal title={t('模型与 API')} onClose={props.onClose}>{content}</Modal>;
 }
 return <LegacyProviderLogin {...props}/>;
}
function LegacyProviderLogin({provider,onClose,onConfigured,onTested,onAccountState,onError,embedded=false,disabled=false,showExit=false}:AccountProps){
 const [confirmRemove,setConfirmRemove]=useState(false),[baseUrl,setBaseUrl]=useState(''),[apiLabel,setApiLabel]=useState('');
 const [sharePublicGuides,setSharePublicGuides]=useState(false),[sharingTouched,setSharingTouched]=useState(false);
 const [reasoningMode,setReasoningMode]=useState('omit'),[reasoningEffort,setReasoningEffort]=useState('');
 const [testing,setTesting]=useState(false),[testResult,setTestResult]=useState(''),[testError,setTestError]=useState<unknown>(null);
 const {show,dismiss}=useToast();
 const testToast=useRef<number|null>(null);
 const [status,setStatus]=useState<any>({}),[busy,setBusy]=useState(false),[region,setRegion]=useState('mainland-cn'),[key,setKey]=useState(''),[plan,setPlan]=useState('coding-cn'),[method,setMethod]=useState('chatgpt'),[codexKey,setCodexKey]=useState(''),[model,setModel]=useState(provider==='compatible'?'':'qwen3-coder-plus');
 const [dirty,setDirty]=useState(false),[accountLoaded,setAccountLoaded]=useState(false),[accountError,setAccountError]=useState<unknown>(null),[loginError,setLoginError]=useState<unknown>(null);
 const lifecycle=useRef(0),revision=useRef(0),operation=useRef(false);
 const loginEvents=useRef(0);
 const [cancelling,setCancelling]=useState(false),[removing,setRemoving]=useState(false);
 const [runtimePrompt,setRuntimePrompt]=useState<CliReadiness|null>(null),[accountRefreshing,setAccountRefreshing]=useState(false);
 const accountSequence=useRef(0),accountFlight=useRef<{epoch:number;promise:Promise<void>}|null>(null);
 const apiProvider=provider==='compatible'||provider==='deepseek';
 function clearTest(){
  setTestResult('');setTestError(null);
  if(testToast.current!==null)dismiss(testToast.current);
  testToast.current=null;
 }
 function changed(){revision.current++;setDirty(true);clearTest();}
 function refreshAccount():Promise<void>{
  if(operation.current)return Promise.resolve();
  const epoch=lifecycle.current;if(accountFlight.current?.epoch===epoch)return accountFlight.current.promise;
  const seq=++accountSequence.current,submittedRevision=revision.current,current=()=>epoch===lifecycle.current&&seq===accountSequence.current;setAccountRefreshing(true);
  const promise=invoke('agent.account',{provider}).then(value=>{if(!current())return;setStatus(value);setAccountLoaded(true);setAccountError(null);if(provider==='compatible'&&!dirty&&submittedRevision===revision.current){setReasoningMode(value.reasoningMode||'omit');setReasoningEffort(value.reasoningEffort||'');setBaseUrl(value.baseUrl||'');setModel(value.model||'');setApiLabel(value.label||'');setSharePublicGuides(value.publicGuidesAllowed===true);}if(!operation.current)setBusy(['starting','authorizing'].includes(value.phase));}).catch(error=>{if(current()){setAccountLoaded(false);setAccountError(error);}}).finally(()=>{if(current()){accountFlight.current=null;setAccountRefreshing(false);}});
  accountFlight.current={epoch,promise};return promise;
 }
 useEffect(()=>{
  const epoch=++lifecycle.current;accountFlight.current=null;setAccountLoaded(false);setAccountError(null);setLoginError(null);setRuntimePrompt(null);void refreshAccount();
  const off=window.studio?.onEvent(event=>{
    if(epoch===lifecycle.current&&event.method==='studio/login'&&event.provider===provider){loginEvents.current++;accountSequence.current++;accountFlight.current=null;setAccountRefreshing(false);setLoginError(null);setStatus(event.params);setBusy(['starting','authorizing'].includes(event.params.phase));if(event.params.phase==='completed'){void refreshAccount().then(()=>{if(epoch===lifecycle.current)onConfigured();});}}
  });
  return()=>{off?.();lifecycle.current++;accountSequence.current++;accountFlight.current=null;operation.current=false;};
 },[provider]);
 async function start(){
  if(disabled||operation.current||busy||testing)return;const epoch=lifecycle.current,submittedRevision=revision.current;operation.current=true;setBusy(true);clearTest();setLoginError(null);
  try{
   if(provider==='kimi'||provider==='qwen'){const readiness=await cliRuntime.inspect(provider);if(epoch!==lifecycle.current)return;if(readiness.status!=='ready'){setRuntimePrompt(readiness);setBusy(false);return;}}
   accountSequence.current++;accountFlight.current=null;setAccountRefreshing(false);
   const eventAtStart=loginEvents.current;
   if(provider==='codex'||provider==='kimi')setStatus((previous:any)=>({...previous,phase:'starting',message:'',url:undefined,userCode:undefined}));
   const result=await invoke('agent.login',provider==='compatible'?{provider,apiKey:key,baseUrl,model,reasoningMode,reasoningEffort,label:apiLabel,...sharingTouched?{sharePublicGuides}:{}}:provider==='deepseek'?{provider,apiKey:key}:provider==='qwen'?{provider,apiKey:key,plan,model}:provider==='codex'?{provider,type:method,...method==='apiKey'?{apiKey:codexKey}:{}}:{provider,region});
   if(epoch!==lifecycle.current)return;
   if(submittedRevision===revision.current){setDirty(false);setSharingTouched(false);setKey('');setCodexKey('');}
   if(loginEvents.current!==eventAtStart)return;
   setStatus(result);
   if(result.phase==='completed'||result.credentialStored===true){setAccountLoaded(true);setAccountError(null);}
   if(result.phase==='failed'||result.phase==='cancelled')setBusy(false);
   if(provider==='qwen'||provider==='deepseek'||provider==='compatible'||provider==='codex'&&result.phase==='completed'){setBusy(false);onConfigured();}
  }catch(e){if(epoch===lifecycle.current){setBusy(false);if(provider==='codex'){setStatus({phase:'failed'});setLoginError(e);}else onError(e);}}finally{if(epoch===lifecycle.current)operation.current=false;}
 }
 async function testConnection(){
  if(disabled||operation.current||busy||testing||dirty||!accountLoaded)return;
  const epoch=lifecycle.current,submittedRevision=revision.current,current=()=>epoch===lifecycle.current&&submittedRevision===revision.current;
  operation.current=true;setTesting(true);clearTest();
  let passed=false;
  try{const result=await invoke('agent.testConnection',{provider});if(!current())return;if(result.status!=='passed')throw Error('API 连接测试未完成。');testToast.current=show({message:t('测试调用成功')+' · '+result.model,testId:'api-connection-feedback'});onTested?.(result.model);passed=true;}catch(error){if(current())setTestError(error);}finally{if(epoch===lifecycle.current){operation.current=false;setTesting(false);}}
  if(passed&&current())void refreshAccount();
 }
 async function cancelCodex(){
  if(operation.current||disabled||!status.loginId)return;
  const epoch=lifecycle.current,eventAtStart=loginEvents.current;operation.current=true;setCancelling(true);
  try{const result=await invoke('agent.login.cancel',{provider:'codex',loginId:status.loginId} satisfies CancelProviderLoginRequest);if(epoch===lifecycle.current&&eventAtStart===loginEvents.current){setStatus(result);setBusy(result.phase==='authorizing');}}
  catch(error){if(epoch===lifecycle.current)onError(error);}
  finally{if(epoch===lifecycle.current){operation.current=false;setCancelling(false);}}
 }
 async function remove(){if(disabled||operation.current||busy||testing)return;const epoch=lifecycle.current;operation.current=true;accountSequence.current++;accountFlight.current=null;setAccountRefreshing(false);setBusy(true);setRemoving(true);clearTest();try{const result=await invoke('agent.logout',{provider});if(epoch===lifecycle.current){setStatus(result);setConfirmRemove(false);}}catch(error){if(epoch===lifecycle.current)onError(error);}finally{if(epoch===lifecycle.current){operation.current=false;setBusy(false);setRemoving(false);}}}
 const accountSummary=status.account?.email||status.account?.type||(status.credentialStored?t('已保存 API 凭据'):
  status.phase?t(loginPhases[status.phase]||status.phase):provider==='codex'&&status.requiresOpenaiAuth===true?t('尚未登录'):t('等待认证状态'));
 const accountState=accountError!=null||!accountLoaded&&status.phase!=='completed'?'unknown':
  provider==='codex'&&status.phase==='completed'&&!status.requiresOpenaiAuth&&!status.metadataUnavailable?'configured':providerAccountState(provider,status);
 useEffect(()=>{onAccountState?.(accountState);},[onAccountState,accountState]);
 const exitCallback=!embedded||showExit?onClose:undefined;
 const configured=accountState==='configured',exitPrimary=!!exitCallback&&configured&&!dirty&&!busy&&!testing;
 const authorizing=!!status.url&&['starting','authorizing'].includes(status.phase);
 const loginPrimary=!exitPrimary&&!authorizing&&(provider!=='kimi'||status.phase!=='completed');
 const testPrimary=configured&&!dirty&&!exitCallback&&status.credentialStored===true;
 const loginPending=t(disabled?'等待当前回复完成':'正在处理…');
 const loginPhase=t(removing?'正在退出登录':cancelling?'正在取消登录':status.phase==='authorizing'?'请在浏览器完成授权':'正在准备登录');
 const inputId=useId();
 const content=<AccountDialogContent onClose={exitCallback} configured={configured} edited={dirty} pending={busy||testing} primaryAvailable={authorizing}>
 <fieldset className="account-login-fields" onChangeCapture={changed} disabled={disabled||apiProvider&&(busy||testing)}>
  <div className="provider-login">
   <div className="account-summary">
    <dl className="account-state-facts">
     <div><dt>{t('实际账户状态')}</dt><dd>{accountSummary}</dd></div>
     <div><dt>{t('模型访问')}</dt><dd>{statusLabel(status.modelAccess||'not_run')}</dd></div>
    </dl>
    <Button disabled={accountRefreshing||busy||testing} disabledReason={loginPending} onClick={()=>void refreshAccount()}>{t('刷新账户状态')}</Button>
   </div>
   <LoadingState busy={accountRefreshing} label={t('正在读取账户状态')}/>
   {provider!=='codex'&&<LoadingState busy={busy||testing} label={t(testing?'正在验证 API 连接':provider==='kimi'?'正在等待 Kimi 登录':'正在保存账户配置')}/>}
   {(provider==='kimi'||provider==='qwen')&&testResult&&<Notice>{testResult}</Notice>}
   {accountError!=null&&<InlineDiagnostic error={accountError} summary={t('账户状态读取失败，请刷新账户状态后重试。')}/>}
   {provider==='codex'&&<>
    <label>{t('登录方式')}<select data-guide-target="login-method" value={method} disabled={busy} onChange={e=>setMethod(e.target.value)}><option value="chatgpt">{t('ChatGPT 浏览器登录')}</option><option value="chatgptDeviceCode">{t('ChatGPT 设备码登录')}</option><option value="apiKey">OpenAI API Key</option></select></label>
    {method==='apiKey'&&<label>API Key<input type="password" data-guide-target="codex-api-key" autoComplete="off" disabled={busy} value={codexKey} onChange={e=>setCodexKey(e.target.value)}/></label>}
    <div className="button-row"><Button variant={loginPrimary?'primary':'secondary'} onClick={()=>void start()} disabled={busy||method==='apiKey'&&!codexKey}
     disabledReason={busy?loginPhase:t('请填写 API Key。')} loading={busy&&!authorizing&&!removing}><LogIn size={15} aria-hidden="true"/>{t(status.phase==='failed'||status.phase==='cancelled'?'重新登录':'开始登录')}</Button>
     {status.phase==='authorizing'&&status.loginId&&<Button disabled={cancelling} disabledReason={loginPhase} onClick={()=>void cancelCodex()}>{t('取消登录')}</Button>}
    </div>
    <LoadingState busy={busy} label={loginPhase}/>
    {status.userCode&&<div className="device-code">{status.userCode}</div>}
    {status.url&&<Button variant={authorizing?'primary':'secondary'} onClick={()=>void invoke('agent.login.open',{provider}).catch(onError)}>{t('打开官方授权页面')}</Button>}
    {status.phase==='failed'&&(loginError!=null?<InlineDiagnostic error={loginError}/>:<Notice severity="error">{t(status.message||'登录失败，请重新登录。')}</Notice>)}
   </>}
   {provider==='kimi'&&<>
    <div className="account-field">
     <div className="account-field-label"><label htmlFor={inputId}>{t('账户地区')}</label><HelpTip label={t('账户地区')} content={t('使用 Kimi Code 官方设备授权。账户凭据保存在本应用独立的 CLI 配置中。')}/></div>
     <select id={inputId} data-guide-target="login-region" value={region} disabled={busy} onChange={e=>setRegion(e.target.value)}><option value="mainland-cn">{t('中国大陆 · kimi.com')}</option><option value="global">{t('国际 · kimi.ai')}</option></select>
    </div>
    <Button variant={loginPrimary?'primary':'secondary'} onClick={()=>void start()} disabled={busy} disabledReason={t('正在等待 Kimi 登录')} loading={busy&&!authorizing}><LogIn size={15} aria-hidden="true"/>{t('开始 Kimi 登录')}</Button>
    {status.url&&<><Notice>{t('在授权页面输入下方终端显示的验证码。')}</Notice><Button variant={authorizing?'primary':'secondary'} onClick={()=>void invoke('agent.login.open',{provider}).catch(onError)}><ExternalLink size={15} aria-hidden="true"/>{t('打开官方授权页面')}</Button></>}
    {status.message&&<Notice severity={status.phase==='failed'?'error':'info'}><pre className="login-output">{redactTranscriptText(status.message)}</pre></Notice>}
    {busy&&<button className="button" onClick={()=>void invoke('agent.login.cancel',{provider:'kimi'} satisfies CancelProviderLoginRequest).catch(onError)}>{t('取消登录')}</button>}
    {status.phase==='completed'&&!exitCallback&&<Button variant="primary" onClick={onConfigured}><CheckCircle2 size={15} aria-hidden="true"/>{t('登录完成，连接 Kimi')}</Button>}
   </>}
   {provider==='compatible'&&<><p>{t('接入支持 Chat Completions、SSE 和工具调用的 OpenAI 兼容接口。')}</p><label>{t('服务名称')}<input value={apiLabel} onChange={e=>setApiLabel(e.target.value)} placeholder="My API"/></label><label>Base URL<input data-testid="compatible-base-url" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://example.com/v1"/></label><label>API Key<small>{t('同一服务地址留空可保留已保存密钥')}</small><input type="password" autoComplete="off" data-testid="compatible-api-key" value={key} onChange={e=>setKey(e.target.value)}/></label><label>{t('模型 ID')}<input data-testid="compatible-model" value={model} onChange={e=>setModel(e.target.value)}/></label><p className="muted">{t('无需模型发现接口，模型名按服务商文档手填。')}</p><label>{t('推理参数')}<select aria-label={t('推理参数')} value={reasoningMode} onChange={e=>setReasoningMode(e.target.value)}><option value="omit">{t('服务商默认 · 不发送')}</option><option value="reasoning_effort">reasoning_effort</option></select></label>{reasoningMode==='reasoning_effort'&&<label>{t('推理强度')}<input aria-label={t('自定义推理强度')} value={reasoningEffort} onChange={e=>setReasoningEffort(e.target.value)} placeholder="low / medium / high" list="reasoning-suggestions"/><datalist id="reasoning-suggestions">{['none','minimal','low','medium','high','xhigh','max'].map(v=><option key={v} value={v}/>)}</datalist><small>{t('仅填写此 API 支持的值；不支持时选择不发送。')}</small></label>}<label className="check-label"><input type="checkbox" checked={sharePublicGuides} onChange={e=>{setSharingTouched(true);setSharePublicGuides(e.target.checked);}}/>{t('允许向此 API 发送公开科学软件指南，不包括私有 CV、凭据或其他研究文件。')}</label><Button variant={exitPrimary||testPrimary?'secondary':'primary'} disabled={busy||testing||!accountLoaded||!baseUrl||!model} disabledReason={t(busy||testing? '正在处理…':!accountLoaded?'账户状态读取失败，请刷新账户状态后重试。':'请填写 API 地址和模型 ID。')} onClick={()=>void start()}>{t('保存 API 配置')}</Button><p className="muted">{t('模型 ID 由你指定，成功调用前标为待验证。更换地址不会把旧对话发送给新服务。')}</p></>}
   {provider==='deepseek'&&<>
    <div className="account-form-grid">
     <label>{t('官方 API 地址')}<input value="https://api.deepseek.com" readOnly/></label>
     <div className="account-field">
      <div className="account-field-label"><label htmlFor={inputId}>DeepSeek API Key</label><HelpTip label="DeepSeek API Key" content={t('密钥由主进程使用系统加密保存。模型是否可用以实际调用为准。')}/></div>
      <input id={inputId} data-testid="deepseek-api-key" data-guide-target="api-key" type="password" autoComplete="off" value={key} disabled={busy} onChange={e=>setKey(e.target.value)} placeholder="sk-…"/>
     </div>
    </div>
    <Button variant={exitPrimary||testPrimary?'secondary':'primary'} disabled={busy||testing||!key} disabledReason={busy||testing?loginPending:t('请填写 API Key。')}
     loading={busy&&!removing} onClick={()=>void start()}><KeyRound size={15} aria-hidden="true"/>{t('保存凭据并连接')}</Button>
   </>}
   {provider==='qwen'&&<>
    <p>{t('Qwen 当前使用百炼 API Key 或 Coding Plan；旧 OAuth 免费登录已停止。')}</p>
    <label>{t('服务与地区')}<select value={plan} onChange={e=>setPlan(e.target.value)}><option value="coding-cn">{t('Coding Plan · 中国大陆')}</option><option value="coding-intl">{t('Coding Plan · 国际')}</option><option value="api-cn">{t('按量 API · 中国大陆')}</option><option value="api-intl">{t('按量 API · 国际')}</option></select></label>
    <label>API Key<input data-testid="qwen-api-key" type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder={plan.startsWith('coding')?'sk-sp-…':'sk-…'}/></label>
    <label>{t('模型 ID')}<input value={model} onChange={e=>setModel(e.target.value)} placeholder="qwen3-coder-plus"/></label>
    <Button variant={exitPrimary?'secondary':'primary'} disabled={busy||!key||!model} disabledReason={busy?loginPending:t(!key?'请填写 API Key。':'请填写至少一个模型 ID。')} onClick={()=>void start()}><KeyRound size={15} aria-hidden="true"/>{t('保存凭据并连接')}</Button>
    <p className="muted">{t('密钥由主进程使用系统加密保存。模型是否可用以实际调用为准。')}</p>
    {status.credentialStored&&<Notice>{t('已有加密凭据，可关闭此窗口直接连接。')}</Notice>}
   </>}
  {['deepseek','compatible'].includes(provider)&&status.credentialStored&&<div>
   <Button variant={testPrimary?'primary':'secondary'} data-testid="test-api-connection" disabled={busy||testing||dirty||!accountLoaded} loading={testing}
    disabledReason={t(busy||testing?'正在处理…':dirty?'配置有未保存修改；保存后验证当前配置。':'账户状态读取失败，请刷新账户状态后重试。')} onClick={()=>void testConnection()}>{t('验证 API 连接')}</Button>
   {dirty&&<Notice severity="warning">{t('配置有未保存修改；保存后验证当前配置。')}</Notice>}
   {testError!=null&&<InlineDiagnostic error={testError} summary={t('API 连接测试未完成。')}/>}
  </div>}
  {((provider==='codex'&&status.account)||(['qwen','deepseek','compatible'].includes(provider)&&status.credentialStored))&&<div className="account-remove">
   <button className="button" disabled={busy||testing} onClick={()=>setConfirmRemove(true)}>{t(provider==='codex'?'退出 Codex 登录':'移除 API 凭据')}</button>
   {confirmRemove&&<ConfirmDialog title={t(provider==='codex'?'退出 Codex 登录':'移除 API 凭据')} target={provider==='codex'?'Codex':t('API 凭据')} tone="danger"
    consequence={t(provider==='codex'?'退出 AIMatterLab 的 Codex 登录；本机 Codex 的登录、对话和计算记录保留。':'移除本机保存的密钥；对话和计算记录保留，不会撤销平台上的密钥。')}
    confirmLabel={t(provider==='codex'?'退出登录':'确认移除')} pending={removing} onCancel={()=>{if(!operation.current)setConfirmRemove(false);}} onConfirm={()=>void remove()}/>}
  </div>}
  </div>
 </fieldset>
 </AccountDialogContent>;
 return <>{embedded?content:<Modal title={t('服务商登录')+' · '+(provider==='codex'?'Codex':provider==='kimi'?'Kimi':provider==='deepseek'?'DeepSeek API':provider==='compatible'?t('自定义 API'):'Qwen')} onClose={onClose}>{content}</Modal>}{runtimePrompt&&(provider==='kimi'||provider==='qwen')&&<CliRuntimeDialog provider={provider} readiness={runtimePrompt} onClose={()=>setRuntimePrompt(null)} onReady={()=>{setRuntimePrompt(null);setTestResult(t('CLI 已就绪，请继续登录。'));}}/>}</>;
}
