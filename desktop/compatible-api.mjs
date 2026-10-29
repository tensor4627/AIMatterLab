export function compatibleCredentials(value){
 if(typeof value.apiKey!=='string'||value.apiKey.length>4096||/[\s\0]/.test(value.apiKey))throw Error('请输入有效的 API Key');
 let url;try{url=new URL(value.baseUrl);}catch{throw Error('请输入 OpenAI 兼容 API 的 Base URL');}
 if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))||/\/(mcp|chat\/completions|responses)\/?$/i.test(url.pathname))throw Error('Base URL 需为 HTTPS 服务根地址或本机 HTTP 地址，例如 https://example.com/v1');
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&value.apiKey.length<8)throw Error('远程 API 需要有效密钥；本机兼容服务可以留空');
 const model=typeof value.model==='string'?value.model.trim():null;if(typeof model!=='string'||!model||model.length>128||!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model))throw Error('请填写服务商提供的模型 ID');
 const reasoningMode=value.reasoningMode||'omit',reasoningEffort=typeof value.reasoningEffort==='string'?value.reasoningEffort.trim():value.reasoningEffort===undefined?'':null;
 if(!['omit','reasoning_effort'].includes(reasoningMode)||typeof reasoningEffort!=='string'||reasoningEffort.length>40||reasoningEffort&&!/^[a-zA-Z0-9_-]+$/.test(reasoningEffort)||reasoningMode==='reasoning_effort'&&!reasoningEffort)throw Error('请选择推理参数模式，并填写服务商支持的推理强度');
 return {apiKey:value.apiKey,baseUrl:url.href.replace(/\/$/,''),model,reasoningMode,reasoningEffort,label:typeof value.label==='string'?value.label.trim().slice(0,40):'OpenAI 兼容 API'};
}
