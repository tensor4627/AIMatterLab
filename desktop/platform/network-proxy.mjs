// Process-local networking only: never changes Windows/Clash settings or persists endpoints.
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const loopback=['localhost','127.0.0.1','::1','[::1]'];
export function windowsProxySettings(output){
 const values={};
 for(const line of output.split(/\r?\n/)){const match=line.match(/^\s*(ProxyEnable|ProxyServer|ProxyOverride|AutoConfigURL)\s+REG_\w+\s+(.*?)\s*$/);if(match)values[match[1]]=match[2];}
 return {enabled:Number(values.ProxyEnable)===1,server:values.ProxyServer||'',bypass:values.ProxyOverride||'',pac:values.AutoConfigURL||''};
}
export function readWindowsProxy({env=process.env,execute=execFileSync}={}){
 const executable=path.win32.join(env.SystemRoot||'C:\\Windows','System32','reg.exe');
 return windowsProxySettings(execute(executable,['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],{encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:128*1024}));
}
function proxyUrl(value,defaultScheme='http'){
 if(!value)return '';
 try{const url=new URL(value.includes('://')?value:defaultScheme+'://'+value);if(!['http:','https:','socks5:','socks5h:','socks4:'].includes(url.protocol)||url.pathname!=='/'&&url.pathname!==''||url.search||url.hash)throw Error();return url.href.replace(/\/$/,'');}
 catch{throw Error('代理地址格式无效，请检查代理设置（不会回退直连）。');}
}
function staticProxies(server){
 if(!server.includes('=')){const proxy=proxyUrl(server);return {http:proxy,https:proxy};}
 const parts=Object.fromEntries(server.split(';').filter(Boolean).map(part=>{const i=part.indexOf('=');return [part.slice(0,i).trim().toLowerCase(),part.slice(i+1).trim()];}));
 return {http:proxyUrl(parts.http),https:proxyUrl(parts.https||parts.http),all:proxyUrl(parts.socks,'socks5')};
}
const get=(env,name)=>env[name.toLowerCase()]||env[name]||'';
function chromiumProxyAddress(address) {
 if (!address) return '';
 const endpoint = new URL(address);
 // Chromium can select DIRECT when a manual proxy rule contains user information.
 endpoint.username = '';
 endpoint.password = '';
 return endpoint.href.replace(/\/$/, '');
}
export function networkProxy({env=process.env,platform=process.platform,readSystem=()=>readWindowsProxy({env}),report=console.log}={}){
 const result={...env};let source='none',http=get(env,'HTTP_PROXY'),https=get(env,'HTTPS_PROXY'),all=get(env,'ALL_PROXY'),bypass='';
 if(http||https||all){source='environment';http=proxyUrl(http);https=proxyUrl(https);all=proxyUrl(all);}
 else if(platform==='win32'){
  let settings;
  try{settings=readSystem();}catch{report('[网络] 无法读取 Windows 系统代理；请检查系统设置或显式代理环境变量。');}
  if(settings?.enabled&&settings.server){({http,https,all}=staticProxies(settings.server));bypass=settings.bypass;source='system';}
  else if(settings?.pac)report('[网络] 检测到 PAC：桌面使用系统 PAC；安装器与 Agent CLI 需要显式 HTTP/mixed 代理配置。');
 }
 if(source==='none')return {env:result,source,sessionConfig:{mode:'system'}};
 // HTTP clients commonly do not read ALL_PROXY. Promote an HTTP(S) fallback only.
 const fallback=/^https?:/.test(all||'')?all:'';
 http ||= fallback;https ||= http||fallback;
 if(http)result.HTTP_PROXY=result.http_proxy=http;
 if(https)result.HTTPS_PROXY=result.https_proxy=https;
 if(all)result.ALL_PROXY=result.all_proxy=all;
 const windowsBypass = bypass.split(';').map(value => value.trim()).filter(Boolean);
 const bypassShortHosts = windowsBypass.some(value => value.toLowerCase() === '<local>');
 const bypassEntries = windowsBypass
  .filter(value => value.toLowerCase() !== '<local>')
  .map(value => value.replace(/^\*\./, '.'));
 const noProxy=[...new Set([...[env.NO_PROXY,env.no_proxy].filter(Boolean).flatMap(value=>value.split(',')),...bypassEntries,...loopback].map(v=>v.trim()).filter(Boolean))].join(',');
 result.NO_PROXY=result.no_proxy=noProxy;
 if(http||https){result.ELECTRON_GET_USE_PROXY='1';result.NODE_USE_ENV_PROXY='1';}
 const rules = [
  http && 'http=' + chromiumProxyAddress(http),
  https && 'https=' + chromiumProxyAddress(https),
  !http && !https && chromiumProxyAddress(all)
 ].filter(Boolean).join(';');
 // Chromium's <local> also matches ordinary, single-label intranet names.
 // Only the loopback exception is unconditional for the local worker.
 const chromiumBypass = new Set([
  ...(bypassShortHosts ? ['<local>'] : []),
  '127.0.0.0/8', '[::1]', ...noProxy.split(',').map(value => value.startsWith('.') ? '*'+value : value)
 ]);
 const sessionConfig={mode:'fixed_servers',proxyRules:rules,proxyBypassRules:[...chromiumBypass].join(';')};
 report(`[网络] 已采用${source==='system'?' Windows 系统':'环境变量'}代理，应用于下载与 Agent 子进程；本机回环直连。此提示不代表连通验证成功。`);
 return {env:result,source,sessionConfig};
}
export async function configureNetworkSession(session,configuration){await session.setProxy(configuration.sessionConfig);}
