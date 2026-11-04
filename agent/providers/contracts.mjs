export const PROVIDERS=['codex','kimi','qwen','deepseek','compatible'];
export const CLI_VERSIONS={kimi:'2.1.1',qwen:'0.24.7'};
export function providerId(id){if(!PROVIDERS.includes(id))throw Error('Unsupported Agent provider');return id;}
export function redact(text,secrets=[]){
 let result=String(text);for(const secret of secrets.filter(Boolean))result=result.replaceAll(secret,'[redacted]');
 return result.replace(/\bsk-[A-Za-z0-9_-]{8,}/g,'[redacted]').replace(/(Bearer\s+)[^\s"']+/gi,'$1[redacted]');
}
export const QWEN_ENDPOINTS={
 'coding-cn':'https://coding.dashscope.aliyuncs.com/v1',
 'coding-intl':'https://coding-intl.dashscope.aliyuncs.com/v1',
 'api-cn':'https://dashscope.aliyuncs.com/compatible-mode/v1',
 'api-intl':'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
};
export function qwenCredentials(value){
 const baseUrl=QWEN_ENDPOINTS[value.plan];
 if(!baseUrl)throw Error('Select a supported Qwen plan and region');
 if(typeof value.apiKey!=='string'||value.apiKey.length<8||value.apiKey.length>512||/\s/.test(value.apiKey))throw Error('Invalid API key');
 if(typeof value.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value.model))throw Error('Enter a model ID');
 if(value.plan.startsWith('coding-')&&!value.apiKey.startsWith('sk-sp-'))throw Error('Coding Plan requires its sk-sp- key');
 return {baseUrl,plan:value.plan,model:value.model,apiKey:value.apiKey};
}
