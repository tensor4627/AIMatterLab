/** Public model configuration. Secrets are stored separately by the main process. */
export const API_PROTOCOLS=['openai-completions','openai-responses','anthropic-messages'];
export const REASONING_LEVELS=['off','minimal','low','medium','high','xhigh','max'];
export const API_PROVIDER_GROUPS=['qwen','compatible'];
export const API_PRESETS={
 'token-cn':{name:'Qwen Token Plan · 中国大陆',baseUrl:'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',api:'openai-completions',catalogProvider:'qwen-token-plan-cn'},
 'coding-cn':{name:'Qwen Coding Plan · 中国大陆（旧版）',baseUrl:'https://coding.dashscope.aliyuncs.com/v1',api:'openai-completions'},
 'coding-intl':{name:'Qwen Coding Plan · 国际',baseUrl:'https://coding-intl.dashscope.aliyuncs.com/v1',api:'openai-completions'},
 'api-cn':{name:'Qwen 百炼按量 API · 中国大陆',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',api:'openai-completions',catalogProvider:'alibaba'},
 'api-intl':{name:'Qwen 百炼按量 API · 国际',baseUrl:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',api:'openai-completions',catalogProvider:'alibaba'},
 custom:{name:'自定义 API',baseUrl:'',api:'openai-completions'}
};
export function apiModelKey(profileId,modelId){return 'api:'+profileId+':'+encodeURIComponent(modelId);}
export function splitApiModelKey(value){if(typeof value!=='string')return null;const match=/^api:([a-z][a-z0-9-]{0,63}):(.+)$/.exec(value);if(!match)return null;try{return {profileId:match[1],modelId:decodeURIComponent(match[2])};}catch{return null;}}
export function validateModelProfile(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid provider configuration');
 if(typeof value.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.id)||!API_PROVIDER_GROUPS.includes(value.provider))throw Error('Invalid provider identity');
 const name=typeof value.name==='string'?value.name.trim():'';if(!name||name.length>80)throw Error('请填写服务商名称（最多 80 字符）');
 let url;try{url=new URL(value.baseUrl);}catch{throw Error('请填写有效的 API Base URL');}
 if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))||/\/(chat\/completions|responses|models|messages|mcp)\/?$/i.test(url.pathname))throw Error('请填写 HTTPS 服务根地址或本机 HTTP 地址，不包含具体请求路径');
 if(!API_PROTOCOLS.includes(value.api))throw Error('不支持的 API 协议');
 if(!Array.isArray(value.models)||!value.models.length||value.models.length>200)throw Error('请配置 1–200 个模型');
 const ids=new Set(),models=value.models.map(item=>{
  if(!item||typeof item!=='object'||typeof item.id!=='string'||!item.id.trim()||item.id.length>200||/[\s\x00-\x1f]/.test(item.id)||ids.has(item.id))throw Error('模型 ID 不能为空或重复');ids.add(item.id);
  const model={id:item.id,...item.name?{name:String(item.name).slice(0,100)}:{}};
  for(const key of ['contextWindow','maxTokens'])if(item[key]!==undefined){if(!Number.isSafeInteger(item[key])||item[key]<1||item[key]>100000000)throw Error('模型容量必须是正整数');model[key]=item[key];}
  if(item.input!==undefined){if(!Array.isArray(item.input)||!item.input.includes('text')||item.input.some(v=>!['text','image'].includes(v)))throw Error('Invalid input modalities');model.input=[...new Set(item.input)];}
  if(item.reasoningEfforts!==undefined){
   if(item.reasoningEfforts===false)model.reasoningEfforts=false;
   else{const entries=Object.entries(item.reasoningEfforts||{});if(!entries.length||!entries.some(([level])=>level!=='off')||entries.some(([level,wire])=>!REASONING_LEVELS.includes(level)||wire===null&&level!=='off'||wire!==null&&(typeof wire!=='string'||!wire||wire.length>40||/[\s\x00-\x1f]/.test(wire))))throw Error('推理等级需包含至少一个思考等级及其 API 参数值');model.reasoningEfforts=Object.fromEntries(entries);}
  }
  if(item.thinkingFormat!==undefined){if(value.api!=='openai-completions'||!['openai','qwen','deepseek'].includes(item.thinkingFormat))throw Error('思考参数格式仅适用于 Chat Completions');model.thinkingFormat=item.thinkingFormat;}
  for(const key of ['supportsReasoningEffort','supportsDeveloperRole','requiresReasoningContentOnAssistantMessages','requiresThinkingAsText'])if(item[key]!==undefined){if(value.api!=='openai-completions'||typeof item[key]!=='boolean')throw Error('Invalid Chat Completions compatibility setting');model[key]=item[key];}
  return model;
 });
 if(value.sharePublicGuides!==undefined&&typeof value.sharePublicGuides!=='boolean')throw Error('Invalid public guide sharing choice');
 const preset=Object.hasOwn(API_PRESETS,value.preset)?value.preset:'custom';
 const baseUrl=url.href.replace(/\/+$/,'');
 // Catalog defaults apply only to the preset's exact official endpoint.
 const catalogProvider=API_PRESETS[preset].baseUrl===baseUrl&&API_PRESETS[preset].api===value.api?API_PRESETS[preset].catalogProvider:undefined;
 return {schemaVersion:1,id:value.id,provider:value.provider,name,baseUrl,api:value.api,preset,models,sharePublicGuides:value.sharePublicGuides===true,defaultModel:models.some(m=>m.id===value.defaultModel)?value.defaultModel:models[0].id,...catalogProvider?{catalogProvider}:{}};
}
