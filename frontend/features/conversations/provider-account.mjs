export const providerNames={codex:'Codex',kimi:'Kimi',qwen:'Qwen',deepseek:'DeepSeek API',compatible:'自定义 API'};

export function providerAccountState(provider,value){
 if(!value||value.metadataUnavailable)return 'unknown';
 if(provider==='codex')return value.account?'configured':value.requiresOpenaiAuth===true?'missing':'unknown';
 if(['deepseek','qwen','compatible'].includes(provider))return value.credentialStored===true?'configured':'missing';
 return value.phase==='completed'||value.modelAccess==='passed'?'configured':'unknown';
}

export function authenticationError(error){return /请先.*(?:登录|API Key)|authentication|unauthorized|not.?logged.?in|\b401\b|缺少.*凭据/i.test(error instanceof Error?error.message:String(error));}
