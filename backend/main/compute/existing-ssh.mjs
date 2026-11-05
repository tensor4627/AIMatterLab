import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
const MAX_BYTES=256*1024,MAX_REFS=512,MAX_FOUND=128,MAX_SCANNED=1024,refs=new Map(),lifetime=30*60*1000;
const whitelist={CONNECTION:new Set(['Host','Port','Protocol']),'CONNECTION:AUTHENTICATION':new Set(['UserName','UserKey','UseAuthProfile','UseInitScript','UseExpectSend']),'CONNECTION:PROXY':new Set(['Proxy']),'CONNECTION:SSH':new Set(['UseAuthAgent','FwdReqCount','RemoteCommand'])};
const owner=home=>path.resolve(home),signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':'),enabled=v=>!!v&&!['0','false','none'].includes(v.toLowerCase());
function codexConnections(home){const file=path.join(home,'.codex','.codex-global-state.json');if(!fs.existsSync(file))return [];try{const values=JSON.parse(fs.readFileSync(file,'utf8'))['codex-managed-remote-connections'];return Array.isArray(values)?values.filter(v=>v&&typeof v.hostname==='string'):[];}catch{return [];}}
function metadata(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.xsh')throw Error('Select one local Xshell session file');
 let stat;try{stat=fs.lstatSync(file);}catch{throw Error('Existing Xshell source is unavailable');}if(stat.isSymbolicLink()||!stat.isFile())throw Error('A regular Xshell session file is required');
 if(stat.size<=0||stat.size>MAX_BYTES)throw Error('Xshell session size exceeds the bounded import limit');
 return {file:path.resolve(file),signature:signature(stat)};
}
function remember(home,data){
 const homeKey=owner(home),now=Date.now();for(const[ref,item]of refs)if(now-item.createdAt>lifetime)refs.delete(ref);
 for(const[ref,item]of refs)if(item.home===homeKey&&item.action===data.action&&item.file===data.file&&item.signature===data.signature)return {ref,label:item.label,source:'xshell',...(item.action?{action:item.action}:{})};
 while(refs.size>=MAX_REFS)refs.delete(refs.keys().next().value);
 const ref='xshell-'+randomBytes(18).toString('hex'),item={...data,home:homeKey,createdAt:now};refs.set(ref,item);return {ref,label:item.label,source:'xshell',...(item.action?{action:item.action}:{})};
}
/** Main-only registration of a path returned by an explicit native file selection. */
export function rememberXshellSession(home,file){const info=metadata(file),label=path.basename(info.file,path.extname(info.file)).replace(/[\r\n\0]/g,'').slice(0,160)||'Xshell session';return remember(home,{...info,label});}
function discover(home,options){
 const documents=options.documents||path.join(home,'Documents'),roots=options.xshellSessionRoots||['8','7','6'].map(v=>path.join(documents,'NetSarang Computer',v,'Xshell','Sessions')),found=[];let directories=0,scanned=0;
 function walk(folder,depth){if(depth>3||directories++>=128||found.length>=MAX_FOUND||scanned>=MAX_SCANNED)return;let dir;try{const stat=fs.lstatSync(folder);if(stat.isSymbolicLink()||!stat.isDirectory())return;dir=fs.opendirSync(folder);}catch{return;}
  try{let entry;while(found.length<MAX_FOUND&&scanned<MAX_SCANNED&&(entry=dir.readSync())){scanned++;if(entry.isSymbolicLink())continue;const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file,depth+1);else if(entry.isFile()&&path.extname(entry.name).toLowerCase()==='.xsh'){try{found.push(rememberXshellSession(home,file));}catch{/* Discovery reads directory/file metadata only. */}}}}catch{/* Discovery remains best-effort and exposes no native paths. */}finally{dir.closeSync();}}
 for(const root of roots.slice(0,8))walk(root,0);return found;
}
// Only labels and opaque native references leave the main process before selection.
export function existingConnections(home,options={}){const known=codexConnections(home).map((c,i)=>({ref:c.hostId||'existing-'+i,label:'已有连接 '+(i+1)})),native=discover(home,options);if(options.includeXshellPicker)native.push(remember(home,{action:'select-session',label:'选择 Xshell 会话文件…'}));return [...known,...native];}
function draft(v){return {name:'已有集群',scheduler:'lsf',host:v.host,username:v.username,target:v.username?v.username+'@'+v.host:v.host,port:v.port,identity_file:v.identity_file||'',ssh_client:'/mnt/c/Windows/System32/OpenSSH/ssh.exe',auth_mode:'key',proxy_jump:[],via:[],remote_root:'~/.gpu-sampling-studio/runs',environment:{executables:{python:'/usr/bin/python3'},repositories:{},variables:{}},activation:'',queue:'',limits:{cpus:64,gpus:8,memory_mb:262144}};}
function readSelected(item){
 if(metadata(item.file).signature!==item.signature)throw Error('Selected Xshell source changed; refresh its reference');
 let fd;try{fd=fs.openSync(item.file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));}catch{throw Error('Existing Xshell source is unavailable');}const result={};let decoder,carry='',section='',total=0;
 function line(text){if(text.length>32768)throw Error('Xshell field exceeds the bounded import limit');const header=text.match(/^\s*\[([^\]]+)\]\s*$/);if(header){section=header[1].toUpperCase();return;}const match=text.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);if(!match||!whitelist[section]?.has(match[1]))return;
  // Skip Password/Passphrase/PIN and other fields before extracting a value.
  const key=section+'/'+match[1];if(Object.hasOwn(result,key))throw Error('Duplicate Xshell connection field');let value=text.slice(text.indexOf('=')+1).trim();if(value.length>2048)throw Error('Xshell reference exceeds the bounded import limit');if(value.length>=2&&value.startsWith('"')&&value.endsWith('"'))value=value.slice(1,-1);result[key]=value;}
 try{if(signature(fs.fstatSync(fd))!==item.signature)throw Error('Selected Xshell source changed');const buffer=Buffer.alloc(4096);let count;
  while((count=fs.readSync(fd,buffer,0,buffer.length,null))){total+=count;if(total>MAX_BYTES)throw Error('Xshell session size exceeds the bounded import limit');let chunk=buffer.subarray(0,count);
   if(!decoder){const utf16=chunk[0]===255&&chunk[1]===254;if(chunk[0]===254&&chunk[1]===255)throw Error('Unsupported Xshell text encoding');decoder=new StringDecoder(utf16?'utf16le':'utf8');if(utf16)chunk=chunk.subarray(2);else if(chunk[0]===239&&chunk[1]===187&&chunk[2]===191)chunk=chunk.subarray(3);}
   carry+=decoder.write(chunk);const lines=carry.split(/\r?\n/);carry=lines.pop();for(const value of lines)line(value);if(carry.length>32768)throw Error('Xshell field exceeds the bounded import limit');}
  carry+=decoder?.end()||'';if(carry)line(carry);if(signature(fs.fstatSync(fd))!==item.signature||metadata(item.file).signature!==item.signature)throw Error('Selected Xshell source changed during import');
 }finally{fs.closeSync(fd);}return result;
}
function nativeDraft(item){
 const data=readSelected(item),get=(s,k)=>data[s+'/'+k]||'';
 if(!['SSH','SSH2'].includes(get('CONNECTION','Protocol').toUpperCase()))throw Error('Unsupported native session protocol; select an SSH Xshell session');
 const host=get('CONNECTION','Host'),username=get('CONNECTION:AUTHENTICATION','UserName'),port=get('CONNECTION','Port');if(!/^[A-Za-z0-9][A-Za-z0-9.:-]{0,255}$/.test(host)||username&&!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(username))throw Error('Invalid Xshell host or username field');if(!/^\d{1,5}$/.test(port)||+port<1||+port>65535)throw Error('Invalid Xshell port field');
 const reasons=[],key=get('CONNECTION:AUTHENTICATION','UserKey');let identity='',kind='default';if(key){if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|^(?:ssh-(?:rsa|ed25519)|ecdsa-[A-Za-z0-9-]+)\s/i.test(key))throw Error('Only a private-key reference can be imported');if(path.isAbsolute(key)||path.win32.isAbsolute(key)){identity=key;kind='file';}else{kind='native_reference';reasons.push('xshell_native_key_reference_requires_review');}}
 if(!username)reasons.push('xshell_username_requires_review');if(enabled(get('CONNECTION:PROXY','Proxy')))reasons.push('xshell_proxy_requires_review');if(enabled(get('CONNECTION:SSH','FwdReqCount')))reasons.push('xshell_forwarding_requires_review');if(get('CONNECTION:SSH','RemoteCommand')||enabled(get('CONNECTION:AUTHENTICATION','UseInitScript'))||enabled(get('CONNECTION:AUTHENTICATION','UseExpectSend')))reasons.push('xshell_startup_requires_review');if(enabled(get('CONNECTION:AUTHENTICATION','UseAuthProfile')))reasons.push('xshell_auth_profile_requires_review');
 return {...draft({host,username,port:+port,identity_file:identity}),name:item.label,source:'xshell',import_review:{requires_review:!!reasons.length,reasons,identity_reference_kind:kind,route_status:reasons.some(c=>/proxy|forwarding/.test(c))?'needs_review':'direct',credential_values_imported:false}};
}
export function existingProfile(home,ref,options={}){
 if(typeof ref!=='string'||!ref||ref.length>256||/[\r\n\0]/.test(ref))throw Error('Invalid existing connection reference');const item=refs.get(ref);
 if(item){if(item.home!==owner(home)||Date.now()-item.createdAt>lifetime)throw Error('Existing connection reference is unavailable');if(item.action==='select-session'){if(typeof options.selectXshellSession!=='function')throw Error('Xshell session selection requires the native picker');return Promise.resolve(options.selectXshellSession()).then(file=>file?existingProfile(home,rememberXshellSession(home,file).ref):{cancelled:true});}return nativeDraft(item);}
 const items=codexConnections(home),c=items.find((v,i)=>(v.hostId||'existing-'+i)===ref);if(!c)throw Error('Existing connection no longer available');const parts=c.hostname.split('@'),host=parts.at(-1),username=c.username||c.user||(parts.length===2?parts[0]:'');return {...draft({host,username,port:c.sshPort||22,identity_file:typeof c.identity==='string'?c.identity:''}),source:'codex'};
}
