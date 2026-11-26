import fs from 'node:fs';
import path from 'node:path';
import {resolveDshRuntime} from '../../desktop/platform/dsh-runtime.mjs';
import {validateModelProfile} from '../../contracts/agent/model-profiles.mjs';
const MAX_BYTES=4*1024*1024;
export function installedModelCatalog(catalogProvider,{runtime=resolveDshRuntime()}={}){
 if(!/^[a-z][a-z0-9-]*$/.test(catalogProvider))return [];
 // Resolve the catalog through the adapter's own declared dependency.
 const adapter=path.join(runtime.modules,'@deepseek-ai/dsh-llm-pi-ai/package.json');
 let directory=path.dirname(adapter),packageRoot;
 for(;;){const candidate=path.join(directory,'node_modules/@earendil-works/pi-ai');if(fs.existsSync(path.join(candidate,'package.json'))){packageRoot=candidate;break;}const parent=path.dirname(directory);if(parent===directory)break;directory=parent;}
 if(!packageRoot)throw Error('DSH 模型目录组件缺失');
 const file=path.join(packageRoot,'dist/providers/data',catalogProvider+'.json');
 if(!fs.existsSync(file))return [];
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));return Object.values(raw).flatMap(group=>Object.values(group)).filter(v=>v.type==='chat').map(v=>{
  const levels=v.reasoning?Object.fromEntries(['off','minimal','low','medium','high','xhigh','max'].flatMap(level=>{const wire=v.thinkingLevelMap?.[level];if(wire===null||wire===undefined&&['xhigh','max'].includes(level))return [];return [[level,wire??(level==='off'?null:level)]];})):false;
  return {id:v.id,name:v.name,contextWindow:v.contextWindow,maxTokens:v.maxTokens,input:v.input,...levels?{reasoningEfforts:levels}:{reasoningEfforts:false},...Object.fromEntries(['thinkingFormat','supportsReasoningEffort','supportsDeveloperRole','requiresReasoningContentOnAssistantMessages','requiresThinkingAsText'].filter(key=>v.compat?.[key]!==undefined).map(key=>[key,v.compat[key]]))};
 });
}
async function readBounded(response){const reader=response.body?.getReader();if(!reader)throw Error('模型发现接口未返回内容');let bytes=0,text='';const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();throw Error('模型目录超过 4 MiB 限制');}text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{reader.releaseLock();}}
export async function discoverProfileModels(profile,{apiKey='',fetchApi=fetch,catalog=installedModelCatalog}={}){
 const config=validateModelProfile({...profile,models:profile.models?.length?profile.models:[{id:'discovery-placeholder'}]});
 const native=config.catalogProvider?catalog(config.catalogProvider):[],defaults=new Map(native.map(v=>[v.id,v]));
 const base=config.baseUrl,url=config.authMode==='deepseek-account'?'https://api.deepseek.com/models':config.api==='anthropic-messages'?base.replace(/\/v1$/,'')+'/v1/models?limit=1000':base+'/models';
 const headers=config.authMode==='deepseek-account'?{'x-dsh-auth-token':apiKey}:config.api==='anthropic-messages'?{'x-api-key':apiKey,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+apiKey};
 let response;try{response=await fetchApi(url,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('模型发现请求失败或超时，请检查服务地址和网络');}
 if(!response.ok){if([404,405,501].includes(response.status)&&native.length)return {models:native,source:'catalog',notice:'此接口不支持模型发现；显示已安装 DSH 的官方服务商目录，实际可用性仍需测试。'};throw Error('模型发现失败 · HTTP '+response.status+([401,403].includes(response.status)?'，请核对密钥和套餐地址':''));}
 let body;try{body=await readBounded(response);}catch(error){throw Error(error.message==='模型目录超过 4 MiB 限制'?error.message:'模型发现接口未返回有效 JSON；响应内容未展示');}
 const rows=Array.isArray(body.data)?body.data:body.models&&typeof body.models==='object'?Object.entries(body.models).map(([id,value])=>({id,...value})):null;
 if(!rows)throw Error('模型发现接口未返回 data 数组或 models 对象');
 const models=[...new Map(rows.filter(v=>typeof v?.id==='string'&&v.id&&!/[\s\x00-\x1f]/.test(v.id)&&v.id.length<=200).slice(0,200).map(v=>{
  const known=defaults.get(v.id)||{},model={...known,id:v.id,name:[v.name,v.display_name,known.name,v.id].find(value=>typeof value==='string'&&value.trim()).slice(0,100)};
  for(const [key,candidates]of [['contextWindow',[v.contextWindow,v.context_window,v.context_length]],['maxTokens',[v.maxTokens,v.max_tokens,v.max_output_tokens]]]){const n=candidates.find(n=>Number.isSafeInteger(n)&&n>0);if(n&&n<=100000000)model[key]=n;}
  return [model.id,model];
 })).values()];return {models,source:'endpoint'};
}
