/** Child processes receive OS/network settings plus one provider's explicit capabilities. */
const SHARED_FIELDS=Object.freeze([
 'SystemRoot','WINDIR','ComSpec','ProgramData','PATH','PATHEXT',
 'TEMP','TMP','TMPDIR','USERPROFILE','LOCALAPPDATA','APPDATA','HOMEDRIVE','HOMEPATH',
 'HOME','USER','LOGNAME','SHELL','LANG','LANGUAGE','LC_ALL','LC_CTYPE','LC_COLLATE',
 'LC_MESSAGES','LC_MONETARY','LC_NUMERIC','LC_TIME','LC_ADDRESS','LC_IDENTIFICATION',
 'LC_MEASUREMENT','LC_NAME','LC_PAPER','LC_TELEPHONE','TZ',
 'TERM','COLORTERM','NO_COLOR','FORCE_COLOR',
 'HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy',
 'SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','REQUESTS_CA_BUNDLE','CURL_CA_BUNDLE',
 'NODE_USE_ENV_PROXY','NODE_USE_SYSTEM_CA'
]);
const PROVIDER_FIELDS=Object.freeze({
 codex:['CODEX_HOME','OPENAI_API_KEY','GSS_MCP_TOKEN'],
 deepseek:['DSH_HOME','DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','ELECTRON_RUN_AS_NODE','GSS_MCP_TOKEN'],
 kimi:['KIMI_CODE_HOME','KIMI_API_KEY','KIMI_BASE_URL'],
 qwen:['QWEN_HOME','QWEN_API_KEY','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','STUDIO_QWEN_API_KEY']
});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function agentEnvironment(provider=null,{parent=process.env,overrides={},platform=process.platform}={}){
 if(provider!==null&&!Object.hasOwn(PROVIDER_FIELDS,provider))throw Error('Unsupported CLI environment provider');
 if(!object(parent)||!object(overrides))throw Error('Invalid CLI environment');
 const fold=key=>platform==='win32'?key.toUpperCase():key;
 const fields=new Map(SHARED_FIELDS.map(key=>[fold(key),key]));
 // Windows environment names are case-insensitive; prefer one canonical spelling.
 if(platform==='win32')for(const key of SHARED_FIELDS)fields.set(fold(key),key.toUpperCase()===key?key:fields.get(fold(key)));
 const read=(key)=>{
  if(typeof parent[key]==='string')return parent[key];
  if(platform==='win32'){const alias=Object.keys(parent).find(name=>fold(name)===fold(key));if(alias!==undefined&&typeof parent[alias]==='string')return parent[alias];}
 };
 const result={};
 for(const key of fields.values()){const value=read(key);if(value!==undefined)result[key]=value;}
 // Codex shares its existing login home. Provider keys and MCP tokens are never inherited.
 if(provider==='codex'){const value=read('CODEX_HOME');if(value!==undefined)result.CODEX_HOME=value;}
 const permitted=new Map([...fields.values(),...(PROVIDER_FIELDS[provider]||[])].map(key=>[fold(key),key]));
 for(const [key,value]of Object.entries(overrides)){
  const target=permitted.get(fold(key));
  if(!target||typeof value!=='string'||value.includes('\0'))throw Error('Unsupported CLI environment override');
  result[target]=value;
 }
 return result;
}
