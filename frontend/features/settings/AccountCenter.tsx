import {useState} from 'react';
import {KeyRound,UserRound} from 'lucide-react';
import ProviderLogin from './ProviderLogin';
import {providerNames} from "../conversations/provider-account.mjs";

import {type AgentProvider} from '../../../contracts/dto/agent';
import {t} from "../../ui/i18n";
import './accounts.css';
export default function AccountCenter({provider:initial,busy,onError}:{provider:AgentProvider;busy:boolean;onError:(error:unknown)=>void}){
 const [provider,setProvider]=useState<AgentProvider>(initial);
 return <div className="account-center" data-testid="account-center"><p className="account-center-intro">{t('账号与 API 配置属于应用，由同一服务商的所有会话共用。切换会话无需重新登录。')}</p><nav className="account-provider-tabs" aria-label={t('账号服务商')}>{Object.entries(providerNames).map(([id,label])=><button key={id} type="button" aria-current={provider===id?'page':undefined} onClick={()=>setProvider(id as AgentProvider)}>{id==='codex'||id==='kimi'?<UserRound size={17}/>:<KeyRound size={17}/>}<span>{t(label)}</span></button>)}</nav><div className="account-provider-content"><ProviderLogin key={provider} embedded disabled={busy} provider={provider} onClose={()=>{}} onConfigured={()=>{}} onError={onError}/></div></div>;
}
