/** Renderer requests select a provider, never a URL, executable or destination. */
export function cliRuntimeRequest(value,{installation=false}={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||!['kimi','qwen'].includes(value.provider))throw Error('Invalid CLI runtime provider');
 const keys=Object.keys(value).sort().join(',');
 if(installation){if(keys!=='provider,requestId'||typeof value.requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value.requestId))throw Error('Invalid CLI installation request');}
 else if(keys!=='provider')throw Error('Invalid CLI runtime request');
 return {...value};
}
