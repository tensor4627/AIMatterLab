import {spawnSync} from 'node:child_process';

export const WSL_ACCESS_DENIED_MESSAGE='当前执行身份无权访问 WSL。请从安装该发行版的 Windows 账户正常桌面启动，或由执行环境管理员配置 WSL 访问权限。';

/** WSL uses UTF-16 on some Windows versions, including its failure stdout. */
export function decodeWslOutput(value){
 if(typeof value==='string')return value.replace(/^\uFEFF/,'');
 let bytes=Buffer.from(value||[]);
 if(bytes[0]===0xfe&&bytes[1]===0xff){
  bytes=Buffer.from(bytes.subarray(2));
  if(bytes.length%2)throw Error('Invalid WSL output encoding');
  bytes.swap16();return bytes.toString('utf16le');
 }
 if(bytes[0]===0xff&&bytes[1]===0xfe)return bytes.subarray(2).toString('utf16le');
 const zeroes=bytes.reduce((count,byte)=>count+(byte===0),0);
 return bytes.toString(zeroes>bytes.length/5?'utf16le':'utf8').replace(/^\uFEFF/,'');
}

function diagnostic(value){
 try{
  if(typeof value==='string')return value.slice(0,65536).replace(/\0/g,'');
  return decodeWslOutput(Buffer.from(value||[]).subarray(0,65536)).replace(/\0/g,'');
 }catch{return '';}
}

/** Never treat a Linux file's ordinary "Permission denied" as a WSL failure. */
export function isWslAccessDenied(error){
 if(error?.code==='E_ACCESSDENIED'||error?.code==='WSL_E_ACCESS_DENIED')return true;
 return [error?.stdout,error?.stderr,error?.message].some(value=>
  /\bWsl\/(?:[A-Za-z0-9_.-]+\/)*E_ACCESSDENIED\b|\bWSL_E_ACCESS_DENIED\b/i.test(diagnostic(value)));
}

/** Read-only capability probe; it never starts a distro or changes its registration. */
export function probeWslAccess({platform=process.platform,probe=spawnSync}={}){
 if(platform!=='win32')return {status:'allowed',reason:'not_windows'};
 let result;
 try{result=probe('wsl.exe',['--list','--quiet'],{windowsHide:true,timeout:6000,maxBuffer:65536,encoding:'buffer'});}
 catch(error){result={error};}
 const error=result?.error;
 if(isWslAccessDenied(result)||isWslAccessDenied(error))return {status:'blocked',reason:'wsl_access_denied',message:WSL_ACCESS_DENIED_MESSAGE};
 if(error?.code==='ENOENT')return {status:'blocked',reason:'wsl_unavailable',message:'未找到 WSL，请先在 Windows 中安装或启用 WSL。'};
 if(error?.code==='ETIMEDOUT'||error?.code==='ABORT_ERR'||error?.killed)return {status:'blocked',reason:'wsl_probe_timeout',message:'读取 WSL 发行版列表超时，请在正常桌面检查 WSL 状态。'};
 if(error||result?.status!==0)return {status:'blocked',reason:'wsl_probe_failed',message:'无法读取 WSL 发行版列表，请在正常桌面检查 WSL 状态。'};
 try{
  const text=decodeWslOutput(result.stdout);
  if(text.length>32768)throw Error('WSL output exceeds bound');
  const names=[...new Set(text.split(/\r?\n/).map(line=>line.replace(/^\s*\*\s*/,'').trim()).filter(Boolean))];
  if(names.length>64||names.some(name=>!/^[\w .-]{1,80}$/.test(name)))throw Error('Invalid WSL distribution inventory');
  if(!names.length)return {status:'blocked',reason:'wsl_distribution_missing',message:'当前 Windows 账户下没有可用的 WSL 发行版，请核对所属账户和发行版登记。'};
  return {status:'allowed',reason:'wsl_accessible',distributions:names};
 }catch{return {status:'blocked',reason:'wsl_probe_failed',message:'无法解析 WSL 发行版列表，请在正常桌面检查 WSL 状态。'};}
}
