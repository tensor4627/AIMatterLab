import {useEffect, useRef, useState} from 'react';
import type {CodexEnvImportMode, CodexEnvImportPrompt, TypedInvoke} from '../../../contracts/dto/ipc';
import {invoke} from '../../api/studio';
import {Modal} from '../../ui/Dialogs';
import {tr} from '../../ui/i18n';

const call:TypedInvoke = invoke;
const sourceHints = {
  absent:'本机没有 Codex .env。将使用独立配置，需要登录时可在下一步使用 ChatGPT 账号。',
  existing:'AIMatterLab 已有独立的 .env，将继续使用该文件。',
  unavailable:'本机 Codex .env 无法读取。可继续使用独立配置，需要登录时可在下一步使用 ChatGPT 账号。'
};

export default function CodexEnvImportDialog() {
  const [prompt, setPrompt] = useState<CodexEnvImportPrompt|null>(null);
  useEffect(()=>{
    const studio = window.studio;
    if (!studio) return;
    let live = true, receivedEvent = false;
    const stop = studio.onEvent(event=>{
      if (event.method === 'studio/codexEnvImport') {
        receivedEvent = true;
        setPrompt(event.params?.prompt ?? null);
      }
    });
    void call('codex.envImport.pending',{}).then(value=>{
      if (live && !receivedEvent && value?.requestId) setPrompt(value);
    }).catch(()=>{});
    return ()=>{live=false;stop();};
  },[]);
  return prompt ? <Choice key={prompt.requestId} prompt={prompt}/> : null;
}

function Choice({prompt}:{prompt:CodexEnvImportPrompt}) {
  const available = prompt.sourceState === 'available';
  const proxyOption = available || prompt.hasSystemProxy;
  const [proxy,setProxy] = useState(!!proxyOption);
  const [whole,setWhole] = useState(false);
  const mode = whole ? 'full' : proxy ? 'proxy' : 'none';
  const [useModelDefaults,setModelDefaults] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function decide(choice:CodexEnvImportMode) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try { await call('codex.envImport.decide',{requestId:prompt.requestId,mode:choice,useModelDefaults,useSystemProxy:!!prompt.hasSystemProxy&&proxy}); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message.split('Error: ').at(-1) : '';
      setError(message || '未能保存选择，请重试。');
    } finally {submitting.current=false;setBusy(false);}
  }
  return <Modal title="首次启动 Codex" onClose={()=>void decide('cancel')} closeDisabled={busy}>
    {(proxyOption || prompt.hasModelDefaults) && <p>{tr('选择从本机 Codex 导入的设置。取消全部勾选即可使用独立配置。')}</p>}
    {proxyOption && <label className="check-label"><input type="checkbox" checked={proxy} disabled={busy} onChange={e=>{setProxy(e.target.checked);if(e.target.checked&&!prompt.hasSystemProxy)setWhole(false);}}/>{tr(prompt.hasSystemProxy?'沿用本机 Codex 代理设置':'仅迁移代理变量')}</label>}
    {available && <>
      <label className="check-label"><input type="checkbox" checked={whole} disabled={busy} onChange={e=>{setWhole(e.target.checked);if(e.target.checked&&!prompt.hasSystemProxy)setProxy(false);}}/>{tr('复制整份 .env')}</label>
      <p className="muted">{tr('整份 .env 可能包含 API 密钥和其他个人配置。')}</p>
    </>}
    {prompt.hasModelDefaults && <><label className="check-label"><input type="checkbox" checked={useModelDefaults} disabled={busy} onChange={e=>setModelDefaults(e.target.checked)}/>{tr('沿用本机默认模型和推理强度')}</label><p className="muted">{tr('从本机 Codex 全局配置读取，登录后按当前账号的模型目录核对，用于新对话。')}</p></>}
    {prompt.sourceState!=='available' && (prompt.sourceState!=='absent'||!proxyOption&&!prompt.hasModelDefaults) && <p>{tr(sourceHints[prompt.sourceState])}</p>}
    {prompt.configIssue && <p className="muted">{tr('本机 Codex 配置无法解析，可以继续使用独立设置。')}</p>}
    {error && <p role="alert">{tr(error)}</p>}
    <div className="button-row"><button className="button" disabled={busy} onClick={()=>void decide('cancel')}>{tr('取消')}</button><button className="button primary" disabled={busy} onClick={()=>void decide(mode)}>{tr('继续启动')}</button></div>
  </Modal>;
}
