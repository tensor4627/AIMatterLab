/** In-memory PTY session. TTY bytes and input are never persisted or logged. */
import path from 'node:path';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {decodeGzipResponse} from './response-codec.mjs';
export class TerminalFault extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
const fail=(code,status)=>{throw new TerminalFault(code,status);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function exact(value,keys,required=keys){if(!object(value)||Object.keys(value).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail('invalid_request');}
const bounded=(v,max)=>typeof v==='string'&&!v.includes('\0')&&Buffer.byteLength(v)<=max;
export function terminalScope(value){exact(value,['provider','threadId','taskId'],['provider','threadId']);if(!bounded(value.provider,80)||!value.provider||!bounded(value.threadId,200)||!value.threadId||value.taskId!==undefined&&(!bounded(value.taskId,200)||!value.taskId))fail('invalid_scope');return {provider:value.provider,threadId:value.threadId,...value.taskId!==undefined?{taskId:value.taskId}:{}};}
const scopeKey=v=>JSON.stringify(terminalScope(v));
export function validateOpen(value){exact(value,['kind','mode','name','launch','ttlMs'],['kind','mode','name','launch']);if(!['local','ssh'].includes(value.kind)||!['interactive','key'].includes(value.mode)||!bounded(value.name,120)||!value.name||/[\r\n]/.test(value.name))fail('invalid_open');const l=value.launch;exact(l,['file','args','cwd','env'],['file','args','cwd']);if(!bounded(l.file,4096)||!path.isAbsolute(l.file)||!bounded(l.cwd,4096)||!path.isAbsolute(l.cwd)||!Array.isArray(l.args)||l.args.length>128||l.args.some(x=>!bounded(x,8192))||Buffer.byteLength(JSON.stringify(l.args))>32768)fail('invalid_launch');if(l.env!==undefined){if(!object(l.env)||Object.keys(l.env).length>128||Object.entries(l.env).some(([k,v])=>! /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)||!bounded(v,8192))||Buffer.byteLength(JSON.stringify(l.env))>32768)fail('invalid_launch');}if(value.ttlMs!==undefined&&(!Number.isSafeInteger(value.ttlMs)||value.ttlMs<1000||value.ttlMs>86400000))fail('invalid_expiry');return structuredClone(value);}
const MAX_RING=512*1024,CHUNK=16384;
function chunks(text){const out=[];let current='',bytes=0;for(const c of text){const n=Buffer.byteLength(c);if(bytes+n>CHUNK){out.push(current);current='';bytes=0;}current+=c;bytes+=n;}if(current)out.push(current);return out;}
const SERVICE_PREFIX='__STUDIO_SERVICE_V1__:',MAX_INSTALL=16*1024*1024,MAX_REPLY=8*1024*1024;
const SERVICE_PHASES=new Set(['waiting_python','checking_cache','transferring_transport','transferring_worker','preparing_runtime','starting_worker','checking_health','ready','stopping','returning_terminal']);
const REMOTE_ERRORS=new Set(['python_unsupported','sqlite_unavailable','tty_unavailable','invalid_hello','protocol_failed','transport_hash_mismatch','transport_cache_invalid','worker_hash_mismatch','worker_cache_invalid','namespace_unsafe','permission_denied','storage_unavailable','worker_start_timeout','worker_start_failed','worker_identity_unavailable','worker_health_invalid','service_request_unconfirmed','internal_error']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const version=value=>Array.isArray(value)&&value.length===3&&value.every(n=>Number.isInteger(n)&&n>=0&&n<=65535);
const serviceId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
function decode64(value,limit){if(typeof value!=='string'||value.length>Math.ceil(limit/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail('service_protocol_failed',502);const bytes=Buffer.from(value,'base64');if(bytes.length>limit||bytes.toString('base64')!==value)fail('service_protocol_failed',502);return bytes;}
function bootstrapMetadata(value){
 exact(value,['protocol','python','sqlite','capabilities'],['protocol','python','sqlite']);if(value.protocol!==2||!version(value.python)||!version(value.sqlite))fail('service_protocol_failed',502);
 if(value.capabilities!==undefined){exact(value.capabilities,['responseEncodings','uploadChunkBytes','workerEncodings'],['responseEncodings','uploadChunkBytes']);const c=value.capabilities;if(!Array.isArray(c.responseEncodings)||c.responseEncodings.length>1||c.responseEncodings.some(v=>v!=='gzip-fragments-v1')||!Array.isArray(c.uploadChunkBytes)||c.uploadChunkBytes.length>3||c.uploadChunkBytes.some(v=>![2048,4096,8192].includes(v))||c.workerEncodings!==undefined&&(!Array.isArray(c.workerEncodings)||c.workerEncodings.length>1||c.workerEncodings.some(v=>v!=='gzip-files-v1')))fail('service_protocol_failed',502);}
}
function vtBoundary(value,prelude=false,bootstrap=false){
 // ConPTY returns a bounded screen update stream, not the original SSH bytes.
 // Accept only display operations outside a complete private frame. Never
 // remove printable characters, edit base64, or interpret arbitrary ANSI/OSC.
 if(value.length>(prelude?512:128))return false;let at=0,count=0;
 while(at<value.length){if(++count>(prelude?32:8))return false;if(prelude&&value[at]==='\r'){at++;continue;}
  const m=/^\x1b\[([0-9;?]*)([A-Za-z])/.exec(value.slice(at));if(!m)return false;const p=m[1],op=m[2];let allowed=op==='K'&&(p===''||p==='0')||op==='X'&&/^(?:[1-9]\d{0,2})?$/.test(p)&&(p===''||Number(p)<=500);
  if(prelude){if(op==='J'&&['2','3'].includes(p)||['h','l'].includes(op)&&(p==='?25'||bootstrap&&p==='25')||bootstrap&&op==='l'&&p==='?2004')allowed=true;if(['H','f'].includes(op)&&/^(?:[1-9]\d{0,2}(?:;[1-9]\d{0,2})?)?$/.test(p)){const [row='1',col='1']=p.split(';');allowed=Number(row||1)<=300&&Number(col)<=500;}}
  if(!allowed)return false;at+=m[0].length;
 }return true;
}
function serviceHealth(value){
 if(!object(value)||value.name!=='gpu-sampling-studio'||value.execution_policy!=='desktop-review-v1'||!['root','runtime'].every(key=>bounded(value[key],4096)&&value[key].startsWith('/')&&value[key]!=='/'&&!/[\r\n]/.test(value[key]))||! /^[a-f0-9]{20}$/.test(value.runtime_id||'')||!bounded(value.hostname,255)||!value.hostname||!Number.isSafeInteger(value.uid)||value.uid<0||!bounded(value.machineId,128)||!value.machineId||!Number.isInteger(value.port)||value.port<1024||value.port>65535||!bounded(value.transport_kind,80)||!value.transport_kind)fail('service_identity_failed',502);
 return Object.fromEntries(['name','execution_policy','root','runtime','runtime_id','hostname','uid','machineId','port','transport_kind'].map(key=>[key,value[key]]));
}
/** A private machine lane on this exact SSH PTY. No second process or login. */
function createServiceLane({terminal,kind,epoch,reserve,prepareRelease,release,available,publish,timeouts={}}){
 let current=null,buffer='',noise=0,fragmentBytes=0,publicCarry='',publicTimer;const starts=new Map(),cancelledStarts=new Set(),fragments=new Map(),resumeMarkers=new Set();
 function flushPublic(){clearTimeout(publicTimer);publicTimer=null;const text=publicCarry;publicCarry='';if(text)publish(text);}
 function publicOutput(data){
  clearTimeout(publicTimer);publicTimer=null;let text=publicCarry+data;publicCarry='';
  // Display cleanup only: ConPTY may repaint a previously confirmed resume
  // marker. Match only exact markers generated by this session, never a general
  // prefix or user command. The STOPPED/output proof above remains unchanged.
  for(const marker of resumeMarkers)text=text.replaceAll(marker,'');
  let hold=0;for(const marker of resumeMarkers)for(let size=Math.min(marker.length-1,text.length);size>hold;size--)if(text.endsWith(marker.slice(0,size))){hold=size;break;}
  if(hold){publicCarry=text.slice(-hold);text=text.slice(0,-hold);publicTimer=setTimeout(flushPublic,75);publicTimer.unref?.();}
  return text;
 }
 const active=()=>!!current?.active;
 const state=()=>({serviceActive:active(),serviceStatus:current?.status||'idle',terminalAccess:active()?(current.status==='failed'?'unknown':'reserved'):'available',...current?{serviceId:current.id,startRequestId:current.requestId,servicePhase:current.publicPhase,...current.progress?{progress:structuredClone(current.progress)}:{}}:{},...current?.health?{service:structuredClone(current.health)}:{},...current?.error?{error:structuredClone(current.error)}:{}});
 const fault=(code='service_transport_unknown')=>{
  if(!current)return;const previous=current.error;current.status='failed';current.error={code,phase:current.publicPhase,...previous?.python?{python:previous.python}:{},...previous?.sqlite?{sqlite:previous.sqlite}:{}};clearTimeout(current.timer);clearTimeout(current.firstTimer);clearTimeout(current.exitTimer);current.startReject?.(new TerminalFault(code,502));current.startReject=null;
  for(const item of current.pending.values()){clearTimeout(item.timer);item.reject(new TerminalFault(code,502));}current.pending.clear();fragments.clear();fragmentBytes=0;
  if(current.stopReject){clearTimeout(current.stopTimer);current.stopReject(new TerminalFault(code,502));current.stopReject=null;}
 };
 const write=(kind,id,value)=>{try{terminal.write(SERVICE_PREFIX+current.nonce+':'+kind+':'+id+':'+Buffer.from(JSON.stringify(value)).toString('base64')+'\n');}catch{fault();}};
 let pumping=false;
 function beginInstall(s,bytes,phase,endKind,endValue){s.install=bytes;s.count=Math.ceil(bytes.length/(s.chunkBytes||2048));s.sent=0;s.acked=0;s.phase='install';s.publicPhase=phase;s.endKind=endKind;s.endValue=endValue;s.progress={kind:'transfer',completedBytes:0,totalBytes:bytes.length};pump();}
 function pump(){
  if(pumping)return;pumping=true;queueMicrotask(()=>{pumping=false;const s=current;if(!s?.active||s.phase!=='install'||s.status!=='connecting')return;
   const chunk=s.chunkBytes||2048;while(s.sent<s.count&&(s.sent-s.acked)*chunk<32768){const index=s.sent++;write('INSTALL',String(index),{chunk:s.install.subarray(index*chunk,(index+1)*chunk).toString('base64')});if(s.status!=='connecting')return;}
   if(s.acked===s.count){s.phase=s.endKind==='TRANSPORT_END'?'transport_ready':'ready';write(s.endKind||'INSTALL_END','-',s.endValue||{size:s.install.length,sha256:s.installSha});s.install=null;}
  });
 }
 function beginReturn(s,failed=false){
  s.phase='returning';s.publicPhase='returning_terminal';s.status='connecting';s.returnFailed=failed;s.progress=null;s.resumeMarker='STUDIO_TERMINAL_RESUMED_'+randomBytes(16).toString('hex');resumeMarkers.add(s.resumeMarker);
  clearTimeout(s.timer);clearTimeout(s.firstTimer);clearTimeout(s.exitTimer);clearTimeout(s.stopTimer);s.stopTimer=setTimeout(()=>fault('service_stop_unknown'),timeouts.stop??10000);
  try{prepareRelease();terminal.write("printf '\\033[2J\\033[3J\\033[H%s\\n' "+shellQuote(s.resumeMarker)+'\r');}catch{fault('service_stop_unknown');}
 }
 function consume(kind,id,value){
  const s=current;if(!s?.active)return;
  if(kind==='STOPPED'&&s.stopId===id){
   // ConPTY may repaint its backing screen when the original width returns.
   // Keep that repaint private, then clear the remote terminal and prove that
   // the original shell has resumed before allowing any public output again.
   beginReturn(s);return;
  }
  if(s.v2&&kind==='ERROR'&&id==='-'){
   exact(value,['code','phase','errno','python','sqlite'],['code','phase']);if(!REMOTE_ERRORS.has(value.code)||!SERVICE_PHASES.has(value.phase)&&value.phase!=='request'||value.errno!==undefined&&(!Number.isInteger(value.errno)||value.errno<0||value.errno>65535)||['python','sqlite'].some(key=>value[key]!==undefined&&!version(value[key])))fail('service_protocol_failed',502);
   s.error=structuredClone(value);s.status='connecting';s.phase='remote_failed';if(value.phase!=='request')s.publicPhase=value.phase;s.health=null;clearTimeout(s.firstTimer);clearTimeout(s.exitTimer);s.exitTimer=setTimeout(()=>fault('service_transport_unknown'),timeouts.stop??10000);
   for(const item of s.pending.values()){clearTimeout(item.timer);item.reject(new TerminalFault('service_remote_failed',502));}s.pending.clear();fragments.clear();fragmentBytes=0;return;
  }
  if(s.v2&&kind==='EXITED'&&id==='-'&&s.phase==='remote_failed'){
   exact(value,['reason']);if(value.reason!=='failed')fail('service_protocol_failed',502);
   for(const item of s.pending.values()){clearTimeout(item.timer);item.reject(new TerminalFault('service_remote_failed',502));}s.pending.clear();fragments.clear();fragmentBytes=0;beginReturn(s,true);return;
  }
  if(s.status==='failed'||s.status==='disconnected')return;
  if(kind==='ERROR'){fault('service_remote_failed');return;}
  if(s.phase==='stopping'&&['COMPRESSED_BEGIN','COMPRESSED_FRAGMENT'].includes(kind)&&s.requests.has(id)){
   if(kind==='COMPRESSED_FRAGMENT'){exact(value,['kind','index','last','chunk']);if(value.kind!=='RESPONSE'||!Number.isSafeInteger(value.index)||value.index<0||typeof value.last!=='boolean')fail('service_protocol_failed',502);decode64(value.chunk,96);}
   else{exact(value,['kind','compressedBytes','uncompressedBytes','sha256']);if(value.kind!=='RESPONSE'||!Number.isSafeInteger(value.compressedBytes)||value.compressedBytes<18||value.compressedBytes>MAX_REPLY||!Number.isSafeInteger(value.uncompressedBytes)||value.uncompressedBytes<1||value.uncompressedBytes>MAX_REPLY||!/^[a-f0-9]{64}$/.test(value.sha256))fail('service_protocol_failed',502);}return;
  }
  if(s.phase==='stopping'&&kind==='RESPONSE'&&s.requests.has(id))return;
  if(s.phase==='stopping'&&kind==='FRAGMENT'&&value.kind==='RESPONSE'&&s.requests.has(id)){
   // Cancellation does not erase bytes already queued by the authenticated
   // helper. Discard a known canceled reply while waiting for its final STOPPED
   // barrier, without reassembling it or weakening the public-output fence.
   exact(value,['kind','index','last','chunk']);if(!Number.isSafeInteger(value.index)||value.index<0||typeof value.last!=='boolean')fail('service_protocol_failed',502);decode64(value.chunk,96);return;
  }
  if(s.phase==='stopping'){
   // Startup cancellation can overtake bytes the helper already queued. These
   // authenticated frames are private observations of the canceled attempt,
   // never a reason to resume input or to continue an upload/bootstrap.
   if(kind==='ACK'&&id===String(s.cancelledAck)&&s.cancelledAck<s.sent){exact(value,['accepted']);if(value.accepted!==s.cancelledAck)fail('service_protocol_failed',502);s.cancelledAck++;return;}
   if(kind==='BOOTSTRAP_READY'&&id==='-'&&s.cancelledPhase==='bootstrap'&&!s.cancelledBootstrap){if(s.v2){bootstrapMetadata(value);}else if(value.protocol!==1)fail('service_protocol_failed',502);s.cancelledBootstrap=true;return;}
   if(s.v2&&id==='-'&&['HELPER_READY','WORKER_READY'].includes(kind)){exact(value,['cached']);if(typeof value.cached!=='boolean')fail('service_protocol_failed',502);return;}
   if(s.v2&&id==='-'&&['TRANSPORT_NEEDED','WORKER_NEEDED'].includes(kind)){exact(value,[]);return;}
   if(s.v2&&kind==='PHASE'&&id==='-'){exact(value,['phase']);if(!['preparing_runtime','starting_worker','checking_health'].includes(value.phase))fail('service_protocol_failed',502);return;}
   if(kind==='READY'&&id==='-'){serviceHealth(value);return;}
   if(kind==='FRAGMENT'&&id==='-'&&value.kind==='READY'){exact(value,['kind','index','last','chunk']);if(!Number.isSafeInteger(value.index)||value.index!==s.cancelledReadyIndex++||typeof value.last!=='boolean')fail('service_protocol_failed',502);s.cancelledReadyBytes+=decode64(value.chunk,96).length;if(s.cancelledReadyBytes>MAX_REPLY)fail('service_protocol_failed',502);return;}
  }
  if(kind==='BOOTSTRAP_READY'&&s.phase==='bootstrap'&&id==='-'){
   if(!s.v2&&value.protocol===1){s.publicPhase='transferring_worker';s.progress={kind:'transfer',completedBytes:0,totalBytes:s.install.length};s.phase='install';pump();return;}
   if(s.v2){bootstrapMetadata(value);clearTimeout(s.firstTimer);s.phase='hello';s.publicPhase='checking_cache';if(value.capabilities){const desired=timeouts.uploadChunkBytes??2048;s.chunkBytes=value.capabilities.uploadChunkBytes.includes(desired)?desired:2048;if(value.capabilities.responseEncodings.includes('gzip-fragments-v1'))s.hello.response_encoding='gzip-fragments-v1';s.hello.upload_chunk_bytes=s.chunkBytes;if(value.capabilities.workerEncodings?.includes('gzip-files-v1')){const metadata=Buffer.from(JSON.stringify({...s.workerPayload,files:s.workerPayload.files.map(({base64,...row})=>row)})),header=Buffer.alloc(4);header.writeUInt32BE(metadata.length);const raw=Buffer.concat([header,metadata,...s.workerPayload.files.map(row=>Buffer.from(row.base64,'base64'))]);s.workerPacked=gzipSync(raw,{level:6});Object.assign(s.hello,{worker_encoding:'gzip-files-v1',worker_gzip_size:s.workerPacked.length,worker_gzip_sha256:hash(s.workerPacked),worker_size:raw.length,worker_sha256:hash(raw)});}}write('HELLO','-',s.hello);return;}
  }
  if(s.v2&&kind==='TRANSPORT_NEEDED'&&id==='-'&&s.phase==='hello'){exact(value,[]);beginInstall(s,s.transportBytes,'transferring_transport','TRANSPORT_END',{size:s.transportBytes.length,sha256:s.hello.transport_sha256});return;}
  if(s.v2&&kind==='HELPER_READY'&&id==='-'&&['hello','transport_ready'].includes(s.phase)){exact(value,['cached']);if(typeof value.cached!=='boolean'||s.phase==='hello'&&!value.cached||s.phase==='transport_ready'&&value.cached)fail('service_protocol_failed',502);s.phase='worker_check';s.publicPhase='checking_cache';s.progress=null;return;}
  if(s.v2&&kind==='WORKER_NEEDED'&&id==='-'&&s.phase==='worker_check'){exact(value,[]);beginInstall(s,s.workerPacked,'transferring_worker','INSTALL_END',{encoding:'gzip',size:s.workerPacked.length,sha256:s.hello.worker_gzip_sha256,uncompressed_size:s.hello.worker_size,uncompressed_sha256:s.hello.worker_sha256});return;}
  if(s.v2&&kind==='WORKER_READY'&&id==='-'&&['worker_check','ready'].includes(s.phase)){exact(value,['cached']);if(typeof value.cached!=='boolean'||s.phase==='worker_check'&&!value.cached||s.phase==='ready'&&value.cached)fail('service_protocol_failed',502);s.phase='ready';s.publicPhase='preparing_runtime';s.progress=null;return;}
  if(s.v2&&kind==='PHASE'&&id==='-'){exact(value,['phase']);if(!SERVICE_PHASES.has(value.phase)||!['preparing_runtime','starting_worker','checking_health'].includes(value.phase)||s.phase!=='ready')fail('service_protocol_failed',502);s.publicPhase=value.phase;return;}
  if(kind==='ACK'&&s.phase==='install'&&id===String(s.acked)&&value.accepted===s.acked&&s.acked<s.sent){exact(value,['accepted']);s.acked++;s.progress.completedBytes=Math.min(s.install.length,s.acked*(s.chunkBytes||2048));pump();return;}
  if(kind==='READY'&&s.phase==='ready'&&id==='-'){s.health=serviceHealth(value);s.status='connected';s.phase='connected';s.publicPhase='ready';s.progress=null;s.transportBytes=null;s.workerPacked=null;s.workerPayload=null;clearTimeout(s.timer);s.startResolve(state());s.startResolve=null;s.startReject=null;return;}
  if(kind==='RESPONSE'&&s.phase==='connected'){
   const item=s.pending.get(id);if(!item)return;if(!Number.isInteger(value.status)||value.status<100||value.status>599||!Object.hasOwn(value,'data'))fail('service_protocol_failed',502);
   clearTimeout(item.timer);s.pending.delete(id);const result=structuredClone(value),bytes=Buffer.byteLength(JSON.stringify(result));
   // Keep the digest ledger after dropping a large old reply: an old request ID
   // may be refused, but must never become eligible for execution again.
   item.promise=s.cachedBytes+bytes<=MAX_REPLY?Promise.resolve(result):null;if(item.promise)s.cachedBytes+=bytes;
   item.resolve(result);item.resolve=null;item.reject=null;return;
  }
  if(kind==='COMPRESSED_BEGIN'){
   exact(value,['kind','compressedBytes','uncompressedBytes','sha256']);
   if(s.hello?.response_encoding!=='gzip-fragments-v1'||s.phase!=='connected'||value.kind!=='RESPONSE'||!s.pending.has(id)||!Number.isSafeInteger(value.compressedBytes)||value.compressedBytes<18||!Number.isSafeInteger(value.uncompressedBytes)||value.uncompressedBytes<1024||value.uncompressedBytes>MAX_REPLY||value.compressedBytes>Math.floor(value.uncompressedBytes*.8)||!/^[a-f0-9]{64}$/.test(value.sha256)||fragments.has('RESPONSE:'+id)||fragments.size>=9||fragmentBytes+value.uncompressedBytes>16*1024*1024)fail('service_protocol_failed',502);
   fragments.set('RESPONSE:'+id,{compressed:true,index:0,bytes:0,parts:[],...value});fragmentBytes+=value.uncompressedBytes;return;
  }
  if(kind==='COMPRESSED_FRAGMENT'){
   exact(value,['kind','index','last','chunk']);const key='RESPONSE:'+id,entry=fragments.get(key);
   if(s.phase!=='connected'||value.kind!=='RESPONSE'||!s.pending.has(id)||!entry?.compressed||entry.decoding||!Number.isSafeInteger(value.index)||value.index!==entry.index++||typeof value.last!=='boolean')fail('service_protocol_failed',502);
   const part=decode64(value.chunk,96);if(part.length!==Math.min(96,entry.compressedBytes-entry.bytes)||value.last!==(entry.bytes+part.length===entry.compressedBytes))fail('service_protocol_failed',502);entry.parts.push(part);entry.bytes+=part.length;
   if(value.last){if(entry.bytes!==entry.compressedBytes)fail('service_protocol_failed',502);const packed=Buffer.concat(entry.parts);if(hash(packed)!==entry.sha256)fail('service_protocol_failed',502);entry.decoding=true;entry.parts=[];
    decodeGzipResponse(packed,entry.uncompressedBytes).then(raw=>{if(current!==s||s.phase!=='connected'||fragments.get(key)!==entry)return;fragments.delete(key);fragmentBytes-=entry.uncompressedBytes;try{const decoded=JSON.parse(raw.toString('utf8'));if(!object(decoded))throw Error();consume('RESPONSE',id,decoded);}catch{fault('service_protocol_failed');}},()=>{if(current===s&&s.phase==='connected'&&fragments.get(key)===entry)fault('service_protocol_failed');});
   }return;
  }
  if(kind==='FRAGMENT'){
   exact(value,['kind','index','last','chunk']);if(!['READY','RESPONSE'].includes(value.kind)||!Number.isSafeInteger(value.index)||value.index<0||typeof value.last!=='boolean'||value.kind==='READY'&&(id!=='-'||s.phase!=='ready')||value.kind==='RESPONSE'&&!s.pending.has(id))fail('service_protocol_failed',502);
   const key=value.kind+':'+id,part=decode64(value.chunk,96);let entry=fragments.get(key);
   if(!entry){if(value.index!==0||fragments.size>=9)fail('service_protocol_failed',502);entry={index:0,bytes:0,parts:[]};fragments.set(key,entry);}
   if(entry.compressed||value.index!==entry.index++||entry.bytes+part.length>MAX_REPLY||fragmentBytes+part.length>16*1024*1024)fail('service_protocol_failed',502);entry.parts.push(part);entry.bytes+=part.length;fragmentBytes+=part.length;
   if(value.last){fragments.delete(key);fragmentBytes-=entry.bytes;const result=JSON.parse(Buffer.concat(entry.parts).toString('utf8'));if(!object(result))fail('service_protocol_failed',502);consume(value.kind,id,result);}return;
  }
  fail('service_protocol_failed',502);
 }
 function receive(data){
  if(!active())return false;
  // Suppress every byte from reservation through confirmed STOPPED, before the
  // terminal ring sees it. Unknown/error phases remain private and unreplayed.
  if(Buffer.byteLength(data)>512*1024){fault('service_protocol_failed');return true;}buffer+=data;
  while(buffer.includes('\n')){const end=buffer.indexOf('\n');let line=buffer.slice(0,end).replace(/\r+$/,'');buffer=buffer.slice(end+1);
   if(current.phase==='returning'&&line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replaceAll('\r','').trim()===current.resumeMarker){
    const s=current;clearTimeout(s.stopTimer);s.active=false;s.status=s.returnFailed?'failed':'disconnected';if(!s.returnFailed)s.error=null;s.health=null;s.transportBytes=null;s.workerPacked=null;s.install=null;fragments.clear();fragmentBytes=0;release();s.stopResolve?.(state());s.stopResolve=null;s.stopReject=null;if(s.returnFailed){s.startResolve?.(state());s.startResolve=null;s.startReject=null;}
    const output=buffer;buffer='';return {output};
   }
   if(current.phase==='returning')continue;
   // A shell may disable bracketed paste immediately before Python takes over,
   // without a newline. Only the nonce-bearing first handshake may follow that
   // startup prefix; authenticated response frames retain exact line grammar.
   if(current.phase==='bootstrap'&&!current.v2){const prefix=SERVICE_PREFIX+current.nonce+':',at=line.indexOf(prefix+'BOOTSTRAP_READY:-:');if(at>0)line=line.slice(at);}
   const ownedPrefix=SERVICE_PREFIX+current.nonce+':',ownedAt=line.indexOf(ownedPrefix);
   if(ownedAt>0){if(vtBoundary(line.slice(0,ownedAt),true,current.v2&&current.phase==='bootstrap'))line=line.slice(ownedAt);else{fault('service_protocol_failed');continue;}}
   if(['stopping','remote_failed'].includes(current.phase)){
    const barrier=SERVICE_PREFIX+current.nonce+(current.phase==='stopping'?':STOPPED:'+current.stopId+':e30=':':EXITED:-:'+Buffer.from('{"reason":"failed"}').toString('base64')),at=line.indexOf(barrier);if(at>0)line=line.slice(at);
    // Real OpenSSH + ConPTY can append Readline's exact bracketed-paste enable
    // at the final control line. Normalize only this observed suffix on this
    // exact owned barrier; the separate fresh-shell output proof still gates
    // all public output and input. Other CSI/printable tails fail closed.
    if(line===barrier+'\r\x1b[?2004h')line=barrier;
   }
   if(line.startsWith(ownedPrefix)){
    const frame=/^([A-Z_]+):(-|[A-Za-z0-9_-]{1,100}):([A-Za-z0-9+/=]+)(.*)$/.exec(line.slice(ownedPrefix.length));
    if(frame&&frame[4]&&vtBoundary(frame[4]))line=ownedPrefix+frame[1]+':'+frame[2]+':'+frame[3];
   }
   if(!line.startsWith(SERVICE_PREFIX+current.nonce+':')){noise+=Buffer.byteLength(line);if(noise>131072)fault('service_protocol_failed');continue;}
   try{const fields=line.slice((SERVICE_PREFIX+current.nonce+':').length).split(':');if(fields.length!==3||! /^[A-Z_]+$/.test(fields[0])||fields[1]!=='-'&&!serviceId(fields[1]))fail('service_protocol_failed',502);const value=JSON.parse(decode64(fields[2],16384).toString('utf8'));if(!object(value))fail('service_protocol_failed',502);consume(fields[0],fields[1],value);}catch{fault('service_protocol_failed');}
   if(!active()){buffer='';break;}
  }if(Buffer.byteLength(buffer)>32768){buffer='';fault('service_protocol_failed');}return true;
 }
 function start(request){
  exact(request,['ownerEpoch','requestId','bootstrap']);if(!serviceId(request.requestId)||!Number.isSafeInteger(request.ownerEpoch))fail('invalid_request');exact(request.bootstrap,['source','payload','transport'],['source','payload']);
  if(cancelledStarts.has(request.requestId))fail('service_start_cancelled',409);
  const {source,payload,transport}=request.bootstrap,v2=transport!==undefined;if(!bounded(source,v2?32768:16384)||!source.trim()||!object(payload))fail('invalid_request');let install;try{install=Buffer.from(JSON.stringify(payload));}catch{fail('invalid_request');}if(install.length>MAX_INSTALL)fail('request_too_large',413);
  let transportBytes,workerPacked,hello,launcher=source;
  if(v2){
   exact(transport,['source','sha256']);if(!bounded(transport.source,128*1024)||!transport.source||!/^[a-f0-9]{64}$/.test(transport.sha256)||hash(Buffer.from(transport.source))!==transport.sha256)fail('invalid_request');
   if(payload.schema_version!==1||!serviceId(payload.profile_id)||!Number.isInteger(payload.port)||payload.port<1024||payload.port>65535||!/^[a-f0-9]{20}$/.test(payload.expected_runtime_id)||!Array.isArray(payload.files)||!payload.files.length||payload.files.length>256)fail('invalid_request');
   const manifest=createHash('sha256'),names=new Set();let bytes=0;
   for(const file of [...payload.files].sort((a,b)=>Buffer.compare(Buffer.from(a?.path||''),Buffer.from(b?.path||'')))){
    exact(file,['path','size','sha256','base64']);if(!bounded(file.path,512)||!file.path||file.path.startsWith('/')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\r\n]/.test(file.path)||names.has(file.path)||!Number.isSafeInteger(file.size)||file.size<0||file.size>2*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256))fail('invalid_request');
    const raw=decode64(file.base64,2*1024*1024);if(raw.length!==file.size||hash(raw)!==file.sha256)fail('invalid_request');bytes+=raw.length;if(bytes>8*1024*1024)fail('request_too_large',413);names.add(file.path);manifest.update(file.path);manifest.update(raw);
   }
   const workerManifest=manifest.digest('hex');if(workerManifest.slice(0,20)!==payload.expected_runtime_id)fail('invalid_request');
   transportBytes=Buffer.from(transport.source);workerPacked=gzipSync(install,{level:6});if(workerPacked.length>8*1024*1024)fail('request_too_large',413);
   hello={schema_version:2,profile_id:payload.profile_id,port:payload.port,expected_runtime_id:payload.expected_runtime_id,worker_manifest_sha256:workerManifest,transport_sha256:transport.sha256,transport_size:transportBytes.length,worker_gzip_size:workerPacked.length,worker_gzip_sha256:hash(workerPacked),worker_size:install.length,worker_sha256:hash(install)};
   launcher='import base64,gzip;exec(compile(gzip.decompress(base64.b64decode("'+gzipSync(Buffer.from(source),{level:6}).toString('base64')+'")),"<studio-service-bootstrap>","exec"))';
   if(Buffer.byteLength('python3 -I -u -c '+shellQuote(launcher)+' '+shellQuote('0'.repeat(64))+'\r')>=4096||/[^\x20-\x7e]/.test(launcher))fail('invalid_request');
  }
  const digest=createHash('sha256').update(source).update(install).update(transport?.sha256||'').digest('hex'),previous=starts.get(request.requestId);if(previous){if(previous.digest!==digest)fail('request_changed',409);return previous.promise;}
  available();if(kind!=='ssh')fail('service_requires_ssh',409);if(active())fail('service_active',423);if(request.ownerEpoch!==epoch())fail('owner_changed',409);if(starts.size>=16)fail('request_limit',429);
  flushPublic();reserve();buffer='';noise=0;fragments.clear();fragmentBytes=0;
  const s=current={id:randomUUID(),requestId:request.requestId,active:true,status:'connecting',phase:'bootstrap',publicPhase:'waiting_python',v2,hello,workerPayload:v2?payload:null,transportBytes,workerPacked,nonce:randomBytes(32).toString('hex'),install:v2?null:install,installSha:hash(install),count:Math.ceil(install.length/2048),sent:0,acked:0,cachedBytes:0,pending:new Map(),requests:new Map()};
  const promise=new Promise((resolve,reject)=>{s.startResolve=resolve;s.startReject=reject;});promise.catch(()=>{});starts.set(request.requestId,{digest,promise});
  if(v2)s.firstTimer=setTimeout(()=>fault('python_response_timeout'),Math.min(15000,timeouts.start??120000));
  s.timer=setTimeout(()=>fault('service_start_unknown'),timeouts.start??120000);
  try{terminal.write((v2?'python3 -I -u -c ':'python3 -u -c ')+shellQuote(launcher)+' '+shellQuote(s.nonce)+'\r');}catch{fault('service_start_unknown');}
  return promise;
 }
 function request(value){
  exact(value,['serviceId','requestId','method','target','data','mcp','timeoutMs'],['serviceId','requestId','method','target','mcp']);available();
  if(value.timeoutMs!==undefined&&(!Number.isInteger(value.timeoutMs)||value.timeoutMs<250||value.timeoutMs>245000))fail('invalid_request');
  if(!serviceId(value.requestId)||!['GET','POST'].includes(value.method)||typeof value.mcp!=='boolean'||!bounded(value.target,8192)||!value.target.startsWith(value.mcp?'/mcp':'/api/')||value.target.startsWith('//')||/[\r\n#\\]/.test(value.target)||value.mcp&&value.target!=='/mcp')fail('invalid_request');
  const s=current;if(!s?.active||s.status!=='connected'||s.phase!=='connected')fail('service_unavailable',409);if(value.serviceId!==s.id)fail('service_changed',409);
  const packet={method:value.method,target:value.target,...Object.hasOwn(value,'data')?{data:value.data}:{},mcp:value.mcp};let encoded;try{encoded=JSON.stringify(packet);}catch{fail('invalid_request');}if(Buffer.byteLength(encoded)>4*1024*1024)fail('request_too_large',413);
  const digest=createHash('sha256').update(encoded).digest('hex'),previous=s.requests.get(value.requestId);if(previous){if(previous.digest!==digest)fail('request_changed',409);if(!previous.promise)fail('service_reply_unavailable',409);return previous.promise;}
  if(s.requests.size>=4096)fail('request_limit',429);if(s.pending.size>=8)fail('service_busy',429);
  let item;const promise=new Promise((resolve,reject)=>{item={resolve,reject};});promise.catch(()=>{});item.digest=digest;item.promise=promise;s.requests.set(value.requestId,item);s.pending.set(value.requestId,item);
  item.timer=setTimeout(()=>fault('service_request_unknown'),Math.min(value.timeoutMs??245000,timeouts.request??245000));write('REQUEST',value.requestId,packet);return promise;
 }
 function stop(value){
  exact(value,['serviceId']);if(value.serviceId!==current?.id)fail('service_changed',409);if(!current?.active)return Promise.resolve(state());if(current.stopPromise)return current.stopPromise;
  const s=current;s.cancelledPhase=s.phase;s.cancelledAck=s.acked;s.cancelledReadyIndex=fragments.get('READY:-')?.index||0;s.cancelledReadyBytes=fragments.get('READY:-')?.bytes||0;fault('service_disconnected');s.status='connecting';s.phase='stopping';s.publicPhase='stopping';s.progress=null;s.stopId=randomUUID();
  s.stopPromise=new Promise((resolve,reject)=>{s.stopResolve=resolve;s.stopReject=reject;});s.stopPromise.catch(()=>{});
  s.stopTimer=setTimeout(()=>fault('service_stop_unknown'),timeouts.stop??10000);write('STOP',s.stopId,{});return s.stopPromise;
 }
 function cancelStart(value){
  exact(value,['requestId']);if(!serviceId(value.requestId))fail('invalid_request');
  if(!cancelledStarts.has(value.requestId)&&cancelledStarts.size>=32)fail('request_limit',429);
  // A tombstone is recorded synchronously even if the POST /start body has not
  // arrived. A late body can therefore never reserve or write to this PTY.
  cancelledStarts.add(value.requestId);
  if(current?.requestId===value.requestId&&current.active)return stop({serviceId:current.id});
  return Promise.resolve(state());
 }
 function dispose(){flushPublic();if(!current)return;fault('service_disconnected');clearTimeout(current.stopTimer);current.stopReject?.(new TerminalFault('service_disconnected',410));current.active=false;current.status='disconnected';}
 return {active,state,start,request,stop,cancelStart,receive,publicOutput,flushPublic,dispose};
}
export function createTerminalSession({pty,plan,id=randomUUID(),now=Date.now,serviceTimeouts}){
 const value=validateOpen(plan);let terminal;try{terminal=pty.spawn(value.launch.file,value.launch.args,{name:'xterm-256color',cols:100,rows:30,cwd:value.launch.cwd,env:value.launch.env??Object.fromEntries(['SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','TEMP','TMP','USERPROFILE'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]))});}catch{fail('spawn_failed',502);}if(!Number.isSafeInteger(terminal.pid)||terminal.pid<=0){try{terminal.kill();}catch{}fail('spawn_failed',502);}
 const createdAt=now(),expiresAt=createdAt+(value.ttlMs??86400000);let alive=true,exitCode=null,exitSignal=null,owner='human',ownerEpoch=1,scope=null,readFloor=0,sequence=0,ringBytes=0,ring=[],closed=false,dimensions={cols:100,rows:30};const requests=new Map();
 const expired=()=>now()>=expiresAt;
 const state=()=>({id,kind:value.kind,mode:value.mode,name:value.name,pid:terminal.pid,alive,exitCode,exitSignal,owner,ownerEpoch,sequence,createdAt,expiresAt,expired:expired(),closed,serviceActive:service.active(),serviceStatus:service.state().serviceStatus,...scope?{scope:structuredClone(scope)}:{}});
 const available=(allowExited=false)=>{if(expired())fail('session_expired',410);if(closed||!alive&&!allowExited)fail('session_exited',410);};
 const authorize=(request,write=false)=>{if(!['human','agent'].includes(request.actor)||!Number.isSafeInteger(request.ownerEpoch))fail('invalid_request');if(write&&service.active())fail('service_active',423);if(request.actor==='agent'){if(owner!=='agent')fail('human_owns_session',423);if(!request.scope||scopeKey(request.scope)!==scopeKey(scope))fail('scope_mismatch',403);}else{if(request.scope!==undefined)fail('invalid_scope');if(write&&owner!=='human')fail('agent_owns_session',423);}if(request.ownerEpoch!==ownerEpoch)fail('owner_changed',409);available(!write);};
 const appendPublic=data=>{if(!alive||closed)return;for(const text of chunks(data)){const item={sequence:++sequence,data:text},bytes=Buffer.byteLength(text);ring.push(item);ringBytes+=bytes;while(ringBytes>MAX_RING){const first=ring.shift();ringBytes-=Buffer.byteLength(first.data);}}};
 const service=createServiceLane({terminal,kind:value.kind,epoch:()=>ownerEpoch,available,publish:appendPublic,reserve(){if(owner!=='human')fail('agent_owns_session',423);try{terminal.resize(500,dimensions.rows);}catch{fail('resize_failed',502);}scope=null;ownerEpoch++;readFloor=sequence;requests.clear();},prepareRelease(){terminal.resize(Math.max(100,dimensions.cols),dimensions.rows);},release(){ownerEpoch++;readFloor=sequence;requests.clear();try{terminal.resize(dimensions.cols,dimensions.rows);}catch{}},timeouts:serviceTimeouts});
 terminal.onData(data=>{if(typeof data!=='string'||!alive||closed)return;const observation=service.receive(data);if(observation===true)return;if(observation)data=observation.output;appendPublic(service.publicOutput(data));});
 terminal.onExit(event=>{service.dispose();alive=false;exitCode=Number.isInteger(event.exitCode)?event.exitCode:null;exitSignal=Number.isInteger(event.signal)?event.signal:null;});
 return {state,
  read(request){exact(request,['actor','scope','ownerEpoch','cursor','maxBytes'],['actor','ownerEpoch']);authorize(request);const cursor=request.cursor??0,max=request.maxBytes??65536;if(!Number.isSafeInteger(cursor)||cursor<0||cursor>sequence||!Number.isSafeInteger(max)||max<CHUNK||max>262144)fail('invalid_cursor');const floor=request.actor==='agent'?readFloor:0,after=Math.max(cursor,floor),first=ring[0]?.sequence??sequence+1,dropped=after<first-1;let bytes=0,output=[];for(const item of ring){if(item.sequence<=after)continue;const n=Buffer.byteLength(item.data);if(bytes+n>max)break;output.push({...item});bytes+=n;}return{state:state(),chunks:output,cursor:output.at(-1)?.sequence??Math.max(after,first-1),dropped};},
  input(request){exact(request,['actor','scope','ownerEpoch','requestId','data'],['actor','ownerEpoch','requestId','data']);authorize(request,true);if(typeof request.requestId!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(request.requestId)||!bounded(request.data,8192)||!request.data)fail('invalid_input');const digest=createHash('sha256').update(JSON.stringify([request.actor,request.actor==='agent'?scopeKey(request.scope):null,request.data])).digest('hex'),previous=requests.get(request.requestId);if(previous){if(previous.digest!==digest)fail('request_changed',409);return{...previous.result,duplicate:true};}if(requests.size>=2048)fail('request_limit',429);service.flushPublic();try{terminal.write(request.data);}catch{fail('input_failed',502);}const result={accepted:true,id,ownerEpoch,requestId:request.requestId};requests.set(request.requestId,{digest,result});return result;},
  owner(request){exact(request,['owner','ownerEpoch','scope'],['owner','ownerEpoch']);available();if(service.active())fail('service_active',423);if(!['human','agent'].includes(request.owner)||request.ownerEpoch!==ownerEpoch)fail('owner_changed',409);const next=request.owner==='agent'?terminalScope(request.scope):null;if(request.owner==='human'&&request.scope!==undefined)fail('invalid_scope');service.flushPublic();owner=request.owner;scope=next;ownerEpoch++;readFloor=sequence;requests.clear();return state();},
  resize(request){exact(request,['actor','scope','ownerEpoch','cols','rows'],['actor','ownerEpoch','cols','rows']);authorize(request,true);if(!Number.isInteger(request.cols)||request.cols<10||request.cols>500||!Number.isInteger(request.rows)||request.rows<2||request.rows>300)fail('invalid_size');try{terminal.resize(request.cols,request.rows);dimensions={cols:request.cols,rows:request.rows};}catch{fail('resize_failed',502);}return{resized:true,id};},
  close(request){exact(request,['actor','scope','ownerEpoch'],['actor','ownerEpoch']);if(!['human','agent'].includes(request.actor)||!Number.isSafeInteger(request.ownerEpoch))fail('invalid_request');if(request.actor==='agent'&&(!request.scope||scopeKey(request.scope)!==scopeKey(scope)))fail('scope_mismatch',403);if(request.ownerEpoch!==ownerEpoch)fail('owner_changed',409);if(!closed){closed=true;ownerEpoch++;}service.dispose();if(alive){try{terminal.kill();}catch{fail('close_failed',502);}}return state();},
  serviceStart:service.start,serviceRequest:service.request,serviceStop:service.stop,serviceCancelStart:service.cancelStart,serviceState:()=>({...state(),...service.state()}),
  dispose(){if(!closed){closed=true;ownerEpoch++;}service.dispose();if(alive){try{terminal.kill();}catch{}}return state();},
  bufferedBytes:()=>ringBytes
 };
}
