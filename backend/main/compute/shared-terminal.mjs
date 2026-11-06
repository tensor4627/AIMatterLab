/** Main-only control bridge. Tokens, launch arguments and authentication bytes never enter MCP. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {computeRuntime} from '../../../desktop/platform/compute-runtime.mjs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';

const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw Error(code);};
const readErrors={cursor:'terminal_invalid_request: cursor must be a non-negative integer sequence returned by read, or omitted.',maxBytes:'terminal_invalid_request: max_bytes must be a positive integer at most 65536, or omitted.'};
const codes=new Set(['terminal_invalid_request','terminal_unavailable','terminal_context_changed','terminal_human_owned','terminal_scope_denied','terminal_encryption_unavailable','terminal_saved_connection_changed','terminal_route_review_required','terminal_client_namespace_required','terminal_unknown_operation',...Object.values(readErrors)]);
const safe=e=>codes.has(e?.message)?e.message:'terminal_unavailable';
function typed(v,keys){if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('terminal_invalid_request');}
function text(v,max=512){return typeof v==='string'&&v.length>0&&v.length<=max&&!/[\r\n\0]/.test(v);}
function identifier(v){return text(v,200)&&/^[A-Za-z0-9_-]+$/.test(v);}
function epoch(v){if(!Number.isSafeInteger(v)||v<0)fail('terminal_invalid_request');return v;}
const ownerScope=value=>value&&text(value.provider,40)&&text(value.threadId)?{provider:value.provider,threadId:value.threadId,...value.taskId?{taskId:value.taskId}:{}}:null;
function checkAncestors(target){for(let p=path.resolve(target);;p=path.dirname(p)){try{const s=fs.lstatSync(p);if(s.isSymbolicLink()||!s.isDirectory())fail('terminal_unavailable');}catch(e){if(e.code!=='ENOENT')throw e;}if(path.dirname(p)===p)break;}}
const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";
const windowsPath=v=>/^\/mnt\/[a-z]\//i.test(v)?v[5].toUpperCase()+':\\'+v.slice(7).replaceAll('/','\\'):v;
const winAbsolute=v=>/^[A-Za-z]:[\\/]/.test(v)||/^\\\\[^\\]/.test(v);

/** Pure launch plan; called only with an authoritative saved profile, never renderer argv. */
export function buildTerminalLaunch(profile,mode,settings={}){
 if(!['interactive','key'].includes(mode)||!object(profile))fail('terminal_invalid_request');
 const host=profile.host,user=profile.username,port=profile.port;
 if(!text(host,255)||!/^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/.test(host)||!text(user,100)||!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(user)||!Number.isInteger(port)||port<1||port>65535)fail('terminal_saved_connection_changed');
 if(profile.import_review?.requires_review===true)fail('terminal_route_review_required');
 const client=profile.ssh_client,key=profile.identity_file||'',jumps=profile.proxy_jump||[],via=profile.via||[];
 if(!text(client,4096)||!text(key||'default',4096)||!Array.isArray(jumps)||jumps.length>8||!Array.isArray(via)||via.length>8||[...jumps,...via].some(v=>!text(v,255)||!/^[A-Za-z0-9_][A-Za-z0-9_.@:\[\]-]*$/.test(v)))fail('terminal_route_review_required');
 const options=['-tt','-o','StrictHostKeyChecking='+ (mode==='interactive'?'ask':'yes'),'-o','BatchMode='+ (mode==='interactive'?'no':'yes'),'-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2'];
 if(jumps.length)options.push('-J',jumps.join(','));
 if(key)options.push('-i',key);
 options.push('-l',user,'-p',String(port),host);
 if(via.length){let remote='';for(const hop of [...via].reverse())remote='ssh -tt -o '+quote('StrictHostKeyChecking='+(mode==='interactive'?'ask':'yes'))+' -o '+quote('BatchMode='+(mode==='interactive'?'no':'yes'))+' '+quote(hop)+(remote?' '+quote(remote):'');options.push(remote);}
 const platform=settings.platform||process.platform,cwd=settings.cwd||process.cwd();
 if(!path.isAbsolute(cwd))fail('terminal_client_namespace_required');
 if(platform==='win32'){
  const native=windowsPath(client);
  if(winAbsolute(native)){
   if(key.startsWith('/')&&!/^\/mnt\/[a-z]\//i.test(key))fail('terminal_client_namespace_required');
   if(key){const at=options.indexOf('-i');options[at+1]=windowsPath(key);}
   return {file:native,args:options,cwd};
  }
  if(!client.startsWith('/')||!text(settings.distribution,200))fail('terminal_client_namespace_required');
  if(key&&winAbsolute(key))fail('terminal_client_namespace_required');
  return {file:path.win32.join(settings.systemRoot||'C:\\Windows','System32','wsl.exe'),args:['--distribution',settings.distribution,'--exec',client,...options],cwd};
 }
 if(!path.isAbsolute(client)||key&&winAbsolute(key))fail('terminal_client_namespace_required');
 return {file:client,args:options,cwd};
}

export function terminalChildEnvironment(env){
 // Windows OpenSSH needs ProgramData during initialization, even for -V.
 const keys=['SystemRoot','WINDIR','ComSpec','ProgramData','PATH','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','HOMEDRIVE','HOMEPATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','SSH_AUTH_SOCK'];
 const result=Object.fromEntries(keys.filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));
 return {...result,ELECTRON_RUN_AS_NODE:'1'};
}
function terminalEnvironment(env,platform){
 const result=terminalChildEnvironment(env);delete result.ELECTRON_RUN_AS_NODE;
 if(platform==='win32'){const win=env.SystemRoot||env.WINDIR||'C:\\Windows';result.PSModulePath=path.win32.join(win,'System32','WindowsPowerShell','v1.0','Modules');}
 return result;
}
function localLaunch(settings,platform,env){
 const cwd=settings.cwd||process.cwd();if(!path.isAbsolute(cwd))fail('terminal_invalid_request');
 if(platform==='win32')return {file:path.win32.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),args:['-NoLogo','-NoProfile','-NoExit'],cwd};
 const shell=env.SHELL&&path.isAbsolute(env.SHELL)?env.SHELL:'/bin/sh';return {file:shell,args:['-i'],cwd};
}
function descriptorValid(d){
 if(!object(d)||!text(d.instanceId)||!/^[a-f0-9]{64}$/.test(d.controlToken||'')||!Number.isSafeInteger(d.pid)||d.pid<1)return false;
 try{const u=new URL(d.origin);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!!u.port&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password&&d.origin===u.origin;}catch{return false;}
}
function localRequest(d,method,route,body){return new Promise((resolve,reject)=>{
 if(!descriptorValid(d)||!/^\/(?:health|sessions(?:\/[A-Za-z0-9_-]+(?:\/(?:state|read|input|resize|owner|close))?)?)$/.test(route))return reject(Error('terminal_unavailable'));
 const data=body===undefined?undefined:JSON.stringify(body),req=http.request(d.origin+route,{method,headers:{Authorization:'Bearer '+d.controlToken,...data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}}},res=>{
  const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){res.destroy();reject(Error('terminal_unavailable'));}else chunks.push(chunk);});
  res.on('error',()=>reject(Error('terminal_unavailable')));res.on('end',()=>{if(res.statusCode!==200)return reject(Error('terminal_unavailable'));try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('terminal_unavailable'));}});
 });req.on('error',()=>reject(Error('terminal_unavailable')));req.setTimeout(5000,()=>{req.destroy();reject(Error('terminal_unavailable'));});if(data)req.write(data);req.end();
});}
const safeState=s=>({id:s.id,sessionId:s.id,kind:s.kind,mode:s.mode,name:s.kind==='ssh'?'SSH terminal':'Local terminal',owner:s.owner,ownerEpoch:s.ownerEpoch,alive:s.alive===true,expired:s.expired===true,status:s.expired===true?'expired':s.alive===true?'running':s.alive===false?'exited':'unknown',sequence:s.sequence||0,...Number.isInteger(s.exitCode)?{exitCode:s.exitCode}:{}});
function stateValid(s){return object(s)&&identifier(s.id)&&['local','ssh'].includes(s.kind)&&['interactive','key'].includes(s.mode)&&['human','agent'].includes(s.owner)&&Number.isSafeInteger(s.ownerEpoch)&&s.ownerEpoch>=0&&typeof s.alive==='boolean';}

export const sharedTerminalTools=Object.freeze([
 {name:'list_shared_terminals',description:'List only terminals the human explicitly handed to this current conversation. Cannot create terminals, change ownership, grant project access or establish scientific/job state.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'read_shared_terminal',description:'Read only post-handoff terminal output for this current conversation. Authentication and pre-handoff output are excluded. Reads preserve whole chunks: a positive max_bytes below 16384 uses a 16 KiB transport page, reported by effective_max_bytes; output is never truncated to the requested smaller budget. Continue with the returned sequence cursor, not a byte offset. A shared shell is not scientific validation or execution approval; formal calculations retain review/service gates. Never automatically resubmit an unknown run.',inputSchema:{type:'object',properties:{session_id:{type:'string'},cursor:{type:'integer',minimum:0,description:'Sequence cursor returned by the previous read; omit for the first read.'},max_bytes:{type:'integer',minimum:1,maximum:65536,description:'Desired positive page budget. Values below 16384 round up to 16384 to preserve complete transport chunks.'}},required:['session_id'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'write_shared_terminal',description:'Write bounded text to an existing terminal explicitly handed to this current conversation. No new session, handoff, approval or grant is provided. Use formal reviewed services for scientific execution; unknown runs must never be automatically resubmitted.',inputSchema:{type:'object',properties:{session_id:{type:'string'},request_id:{type:'string'},data:{type:'string',maxLength:8192}},required:['session_id','request_id','data'],additionalProperties:false},annotations:{readOnlyHint:false}}
]);

/** Sender validation remains in main.handle. Injected storage/transport keep unit checks local. */
export function createSharedTerminal({worker={},profiles,encryption,root,catalog,current=()=>null,settings=()=>({}),sourceGuard=()=>{},getSelectedResource=()=>null,selectionRevision=()=>0,runtimeRoot=path.join(root,'runtime'),dependencyRoot,servicePath=computeRuntime.terminalServicePath,nodeExecutable=process.execPath,spawn=computeRuntime.spawnProcess,requestApi=localRequest,platform=process.platform,env=process.env,uuid=randomUUID,secret=()=>randomBytes(32).toString('hex'),readyTimeoutMs=10000}){
 if(!path.isAbsolute(root)||!path.isAbsolute(runtimeRoot)||!text(dependencyRoot,4096)||!path.isAbsolute(dependencyRoot)||!path.isAbsolute(servicePath)||!path.isAbsolute(nodeExecutable))fail('terminal_invalid_request');
 const descriptorFile=path.join(root,'broker.bin'),known=new Map(),grants=new Map(),opening=new Map(),uncertain=new Set();let daemon=null,booting=null,restored=false;
 for(const record of catalog?.list?.('shared-terminal')||[])if(identifier(record.id))known.set(record.id,{...record,alive:undefined});
 for(const record of catalog?.list?.('shared-terminal-pending')||[])if(identifier(record.id))uncertain.add(record.id);
 const snapshot=(independent=false)=>({independent,selection:structuredClone(current()),resourceRevision:selectionRevision(),connection:worker.connection,epoch:worker.connectionEpoch,identity:structuredClone(worker.identity),target:structuredClone(worker.connectionTarget),source:worker.connectedSource});
 const check=c=>{if(c.resourceRevision!==selectionRevision()||!equal(c.selection,current())||!c.independent&&(c.connection!==worker.connection||c.epoch!==worker.connectionEpoch||!equal(c.identity,worker.identity)||!equal(c.target,worker.connectionTarget)||c.source!==worker.connectedSource))fail('terminal_context_changed');};
 const resourceAllowed=(id,profile)=>{const selected=getSelectedResource();return !selected||selected.kind==='ssh-terminal'&&selected.sessionId===id&&profile?.profileId===selected.profileId&&profile.version===selected.profileVersion;};
 const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const sourceStamp=()=>digest([worker.identity,worker.connectionTarget,worker.connectedSource]);
 function registryLaunch(profileId,version,mode){let p;try{p=profiles?.read({id:profileId,version});}catch{fail('terminal_saved_connection_changed');}if(!p||p.id!==profileId||p.version!==version||p.kind!=='ssh'||p.mode!==mode)fail('terminal_saved_connection_changed');const launch=buildTerminalLaunch(p,mode,{...settings(),platform,distribution:p.distribution,systemRoot:env.SystemRoot||env.WINDIR});return {launch,proof:{profileId,version,planHash:digest(launch)}};}
 function checkProfile(proof,mode){if(!proof||!equal(registryLaunch(proof.profileId,proof.version,mode).proof,proof))fail('terminal_saved_connection_changed');}
 const describe=s=>{const profile=known.get(s.id)?.profile;return {...safeState(s),...s.kind==='ssh'&&profile?{resource:{kind:'ssh-terminal',profileId:profile.profileId,profileVersion:profile.version}}:{}};};
 const remember=s=>{if(!stateValid(s))fail('terminal_unavailable');known.set(s.id,{...known.get(s.id),id:s.id,kind:s.kind,mode:s.mode,owner:s.owner,ownerEpoch:s.ownerEpoch,alive:s.alive,expired:s.expired===true,...Number.isFinite(s.expiresAt)?{expiresAt:s.expiresAt}:{},sequence:s.sequence||0,exitCode:s.exitCode});catalog?.put?.('shared-terminal',s.id,known.get(s.id));return describe(s);};
 const unknown=()=>[...known.values()].map(s=>({...describe(s),alive:null,status:'unknown',owner:'human'}));
 const encrypted=()=>{if(!encryption?.isEncryptionAvailable?.())fail('terminal_encryption_unavailable');};
 const save=d=>{encrypted();checkAncestors(root);fs.mkdirSync(root,{recursive:true,mode:0o700});const tmp=descriptorFile+'.'+uuid()+'.tmp';fs.writeFileSync(tmp,encryption.encryptString(JSON.stringify(d)),{mode:0o600,flag:'wx'});fs.renameSync(tmp,descriptorFile);};
 const rpc=(method,route,body)=>{if(!daemon)fail('terminal_unavailable');return requestApi(daemon,method,route,body);};
 async function restore(){
  if(restored)return !!daemon;restored=true;
  if(!fs.existsSync(descriptorFile))return false;
  try{encrypted();checkAncestors(root);const stat=fs.lstatSync(descriptorFile);if(stat.isSymbolicLink()||stat.size>65536)fail('terminal_unavailable');const d=JSON.parse(encryption.decryptString(fs.readFileSync(descriptorFile)));if(!descriptorValid(d))return false;const h=await requestApi(d,'GET','/health');if(h?.instanceId!==d.instanceId||h.pid!==d.pid)return false;daemon=d;
   const response=await rpc('GET','/sessions');const list=Array.isArray(response)?response:response.sessions;if(!Array.isArray(list)||list.length>16)fail('terminal_unavailable');
   for(const s of list){if(!stateValid(s))fail('terminal_unavailable');if(s.owner==='agent'&&s.alive&&!s.expired)remember(await rpc('POST','/sessions/'+s.id+'/owner',{owner:'human',ownerEpoch:s.ownerEpoch}));else remember(s);}return true;
  }catch{daemon=null;return false;}
 }
 async function start(){
  encrypted();checkAncestors(runtimeRoot);fs.mkdirSync(runtimeRoot,{recursive:true,mode:0o700});const run=path.join(runtimeRoot,uuid());fs.mkdirSync(run,{mode:0o700});const controlToken=secret(),instanceId=uuid();
  const child=spawn(nodeExecutable,[servicePath],{cwd:path.dirname(servicePath),detached:true,windowsHide:true,env:terminalChildEnvironment(env),stdio:['pipe','pipe','ignore']});
  const ready=await new Promise((resolve,reject)=>{let buffer='',done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);child.stdout?.removeListener('data',onData);error?reject(Error('terminal_unavailable')):resolve(value);};const onData=chunk=>{buffer+=chunk.toString('utf8');if(Buffer.byteLength(buffer)>4096)return finish(true);if(buffer.includes('\n')){try{const value=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));if(value?.instanceId!==instanceId||value.pid!==child.pid)return finish(true);finish(false,value);}catch{finish(true);}}};const timer=setTimeout(()=>finish(true),readyTimeoutMs);child.once('error',()=>finish(true));child.once('exit',()=>finish(true));child.stdout.on('data',onData);child.stdin.on('error',()=>finish(true));child.stdin.end(JSON.stringify({controlToken,instanceId,runtimeRoot:run,dependencyRoot})+'\n');});
  const d={...ready,controlToken,runtimeRoot:run};if(!descriptorValid(d))fail('terminal_unavailable');daemon=d;save(d);child.stdout?.destroy();child.unref?.();return true;
 }
 async function ensure(create=false){if(daemon)return true;if(booting){await booting;if(daemon)return true;}booting=(async()=>{if(await restore())return true;return create?start():false;})();try{return await booting;}finally{booting=null;}}
 async function api(method,route,body){try{return await rpc(method,route,body);}catch{daemon=null;restored=false;grants.clear();for(const [id,value]of known)known.set(id,{...value,alive:undefined});fail('terminal_unavailable');}}
 async function state(id){if(!identifier(id)||!await ensure())fail('terminal_unavailable');const s=await api('GET','/sessions/'+id+'/state');remember(s);return s;}
 const guarded=fn=>async(...args)=>{try{return await fn(...args);}catch(e){throw Error(safe(e));}};
 async function list(data={}){typed(data,[]);const c=snapshot();if(!await ensure()){check(c);return {sessions:unknown()};}const response=await api('GET','/sessions');check(c);const items=Array.isArray(response)?response:response.sessions;if(!Array.isArray(items)||items.length>16)fail('terminal_unavailable');return {sessions:[...items.map(remember),...unknown().filter(s=>!items.some(t=>t.id===s.id))]};}
 async function openOnce(data,routeKey){const independent=data.profileId!==undefined,c=snapshot(independent),source=data.kind==='ssh'&&!independent?sourceStamp():null;let launch,launchSettings,profileProof;
  if(independent){if(!identifier(data.profileId)||!Number.isInteger(data.version)||data.version<1)fail('terminal_saved_connection_changed');const planned=registryLaunch(data.profileId,data.version,data.mode);launch=planned.launch;profileProof=planned.proof;}
  else if(data.kind==='ssh'){if(!identifier(data.clusterId)||!Number.isInteger(data.version)||data.version<1||!worker.connection)fail('terminal_saved_connection_changed');sourceGuard();const profile=await worker.request('POST','/api/cluster/profile',{cluster_id:data.clusterId});check(c);sourceGuard();if(profile?.id!==data.clusterId||profile.version!==data.version)fail('terminal_saved_connection_changed');launchSettings={...settings(),platform,distribution:worker.identity?.distribution,systemRoot:env.SystemRoot||env.WINDIR};launch=buildTerminalLaunch(profile,data.mode,launchSettings);}
  else launch=localLaunch(settings(),platform,env);
  if(!await ensure(false)){check(c);if([...known.values()].some(s=>s.routeKey===routeKey))fail('terminal_unavailable');await ensure(true);}check(c);
  const response=await api('GET','/sessions');check(c);const items=Array.isArray(response)?response:response.sessions;if(!Array.isArray(items)||items.length>16)fail('terminal_unavailable');
  if(profileProof)checkProfile(profileProof,data.mode);
  for(const item of items){remember(item);if(item.alive&&known.get(item.id)?.routeKey===routeKey)return describe(item);}
  if(uncertain.has(routeKey))fail('terminal_unavailable');
  if(data.kind==='ssh'&&!independent){const latest=await worker.request('POST','/api/cluster/profile',{cluster_id:data.clusterId});check(c);sourceGuard();if(latest?.id!==data.clusterId||latest.version!==data.version||!equal(buildTerminalLaunch(latest,data.mode,launchSettings),launch))fail('terminal_saved_connection_changed');}
  launch.env=terminalEnvironment(env,platform);uncertain.add(routeKey);catalog?.put?.('shared-terminal-pending',routeKey,{status:'unknown'});
  const s=await api('POST','/sessions/open',{kind:data.kind,mode:data.mode,name:data.kind==='ssh'?'SSH terminal':'Local terminal',launch});
  remember(s);known.set(s.id,{...known.get(s.id),source,routeKey,...profileProof?{profile:profileProof}:{}});catalog?.put?.('shared-terminal',s.id,known.get(s.id));uncertain.delete(routeKey);catalog?.remove?.('shared-terminal-pending',routeKey);check(c);if(profileProof)checkProfile(profileProof,data.mode);return describe(s);
 }
 async function open(data){typed(data,['kind','mode','clusterId','profileId','version']);if(!['local','ssh'].includes(data.kind)||!['interactive','key'].includes(data.mode)||data.profileId!==undefined&&(data.kind!=='ssh'||data.clusterId!==undefined))fail('terminal_invalid_request');if(data.kind==='local'&&(data.clusterId!==undefined||data.profileId!==undefined||data.version!==undefined))fail('terminal_invalid_request');const routeKey=data.profileId!==undefined?digest(['desktop-profile',data.profileId,data.version,data.mode]):digest([data.kind,data.mode,data.clusterId||null,data.version||null,data.kind==='ssh'?sourceStamp():null]);if(opening.has(routeKey))return opening.get(routeKey);const promise=openOnce(data,routeKey);opening.set(routeKey,promise);try{return await promise;}finally{if(opening.get(routeKey)===promise)opening.delete(routeKey);}}
 async function ownedHuman(data,keys){typed(data,['sessionId',...keys]);const c=snapshot(!!known.get(data.sessionId)?.profile);const s=await state(data.sessionId);check(c);return {c,s};}
 function boundsRead(data){if(data.cursor!==undefined)epoch(data.cursor);if(data.maxBytes!==undefined&&(!Number.isInteger(data.maxBytes)||data.maxBytes<16384||data.maxBytes>65536))fail('terminal_invalid_request');}
 function inputValid(data){if(typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.requestId)||typeof data.data!=='string'||!data.data||Buffer.byteLength(data.data)>8192)fail('terminal_invalid_request');}
 function readResult(r,id){if(!object(r)||!stateValid(r.state)||r.state.id!==id||!Array.isArray(r.chunks)||r.chunks.length>512||r.chunks.some(c=>!Number.isSafeInteger(c.sequence)||typeof c.data!=='string')||r.chunks.reduce((n,c)=>n+Buffer.byteLength(c.data),0)>262144||!Number.isSafeInteger(r.cursor))fail('terminal_unavailable');return {...remember(r.state),chunks:r.chunks.map(c=>({sequence:c.sequence,data:c.data})),output:r.chunks.map(c=>c.data).join(''),cursor:r.cursor,dropped:r.dropped===true};}
 async function read(data){boundsRead(data);epoch(data.ownerEpoch);const {c,s}=await ownedHuman(data,['ownerEpoch','cursor','maxBytes']);const r=await api('POST','/sessions/'+s.id+'/read',{actor:'human',ownerEpoch:data.ownerEpoch,...data.cursor!==undefined?{cursor:data.cursor}:{},...data.maxBytes?{maxBytes:data.maxBytes}:{}});check(c);return readResult(r,s.id);}
 async function input(data){inputValid(data);epoch(data.ownerEpoch);const {c,s}=await ownedHuman(data,['ownerEpoch','requestId','data']);if(s.owner!=='human')fail('terminal_human_owned');await api('POST','/sessions/'+s.id+'/input',{actor:'human',ownerEpoch:data.ownerEpoch,requestId:data.requestId,data:data.data});check(c);return {accepted:true,sessionId:s.id};}
 async function resize(data){if(!Number.isInteger(data.cols)||data.cols<10||data.cols>500||!Number.isInteger(data.rows)||data.rows<2||data.rows>300)fail('terminal_invalid_request');const {c,s}=await ownedHuman(data,['cols','rows']);await api('POST','/sessions/'+s.id+'/resize',{actor:'human',ownerEpoch:s.ownerEpoch,cols:data.cols,rows:data.rows});check(c);return {accepted:true};}
 async function owner(data){typed(data,['sessionId','ownerEpoch','owner']);epoch(data.ownerEpoch);if(!['human','agent'].includes(data.owner))fail('terminal_invalid_request');grants.delete(data.sessionId);const {c,s}=await ownedHuman(data,['ownerEpoch','owner']),profile=known.get(s.id)?.profile;const scope=data.owner==='agent'?ownerScope(current()):null;if(data.owner==='agent'){if(!scope||!resourceAllowed(s.id,profile))fail('terminal_scope_denied');if(profile)checkProfile(profile,s.mode);else if(s.kind==='ssh'&&known.get(s.id)?.source!==sourceStamp())fail('terminal_scope_denied');}const updated=await api('POST','/sessions/'+s.id+'/owner',{owner:data.owner,ownerEpoch:data.ownerEpoch,...scope?{scope}:{}});check(c);const result=remember(updated);if(scope){if(profile)checkProfile(profile,s.mode);grants.set(s.id,{scope,ownerEpoch:updated.ownerEpoch,selectionRevision:selectionRevision(),source:known.get(s.id).source,...profile?{profile:structuredClone(profile)}:{}});}return result;}
 async function close(data){typed(data,['sessionId']);grants.delete(data.sessionId);const {c,s}=await ownedHuman(data,[]);await api('POST','/sessions/'+s.id+'/close',{actor:'human',ownerEpoch:s.ownerEpoch});check(c);known.delete(s.id);catalog?.remove?.('shared-terminal',s.id);return {closed:true,sessionId:s.id};}
 // Main-only resource facts. Never creates a terminal, reads its output, changes
 // ownership or treats an alive SSH process as authentication/worker evidence.
 async function resourceState(data){
  typed(data,['sessionId']);if(!identifier(data.sessionId))fail('terminal_invalid_request');
  const c=snapshot(true),entry=known.get(data.sessionId),profile=entry?.profile;
  if(entry?.kind!=='ssh'||!profile)fail('terminal_saved_connection_changed');
  checkProfile(profile,entry.mode);const s=await state(data.sessionId);check(c);
  if(s.id!==data.sessionId||s.kind!=='ssh')fail('terminal_unavailable');checkProfile(profile,s.mode);
  const grant=grants.get(s.id),selected=ownerScope(current()),agentReady=!!(s.alive&&!s.expired&&(!Number.isFinite(s.expiresAt)||s.expiresAt>Date.now())&&s.owner==='agent'&&selected&&grant&&equal(grant.scope,selected)&&grant.ownerEpoch===s.ownerEpoch&&grant.selectionRevision===selectionRevision()&&equal(grant.profile,profile)&&resourceAllowed(s.id,profile));
  return {resource:{kind:'ssh-terminal',profileId:profile.profileId,profileVersion:profile.version},sessionId:s.id,operator:s.owner,ownerEpoch:s.ownerEpoch,processStatus:s.expired?'expired':s.alive?'running':'exited',alive:s.alive,agentReady,authentication:'not_observed',managedRuns:false};
 }
 function agent(scope,id){const selected=ownerScope(current()),grant=grants.get(id);if(!scope||scope.checkCurrent?.()!==true||!selected||!equal(ownerScope(scope),selected)||!grant||!equal(grant.scope,selected)||grant.selectionRevision!==selectionRevision()||!resourceAllowed(id,grant.profile))fail('terminal_scope_denied');if(grant.profile)checkProfile(grant.profile,known.get(id)?.mode);else{if(grant.source&&grant.source!==sourceStamp())fail('terminal_context_changed');sourceGuard();}return grant;}
 async function callTool(name,args,scope){
  if(name==='list_shared_terminals'){typed(args,[]);if(!scope||scope.checkCurrent?.()!==true||!equal(ownerScope(scope),ownerScope(current()))||!ownerScope(current()))fail('terminal_scope_denied');const result=[];for(const [id,grant]of grants){if(!equal(grant.scope,ownerScope(current()))||grant.source&&grant.source!==sourceStamp()||grant.selectionRevision!==selectionRevision()||!resourceAllowed(id,grant.profile))continue;const c=snapshot(!!grant.profile);agent(scope,id);const s=await state(id);check(c);if(agent(scope,id)!==grant)fail('terminal_scope_denied');if(s.owner==='agent'&&s.ownerEpoch===grant.ownerEpoch)result.push(describe(s));}return {sessions:result};}
  if(!['read_shared_terminal','write_shared_terminal'].includes(name))fail('terminal_unknown_operation');typed(args,name==='read_shared_terminal'?['session_id','cursor','max_bytes']:['session_id','request_id','data']);if(!identifier(args.session_id))fail('terminal_invalid_request');const id=args.session_id,grant=agent(scope,id),c=snapshot(!!grant.profile);if(!await ensure())fail('terminal_unavailable');check(c);if(agent(scope,id)!==grant)fail('terminal_scope_denied');
  if(name==='read_shared_terminal'){if(args.cursor!==undefined&&(!Number.isSafeInteger(args.cursor)||args.cursor<0))fail(readErrors.cursor);if(args.max_bytes!==undefined&&(!Number.isSafeInteger(args.max_bytes)||args.max_bytes<1||args.max_bytes>65536))fail(readErrors.maxBytes);const effective=Math.max(16384,args.max_bytes??65536);const r=await api('POST','/sessions/'+id+'/read',{actor:'agent',scope:grant.scope,ownerEpoch:grant.ownerEpoch,...args.cursor!==undefined?{cursor:args.cursor}:{},maxBytes:effective});check(c);if(agent(scope,id)!==grant)fail('terminal_scope_denied');return {...readResult(r,id),...args.max_bytes!==undefined?{requested_max_bytes:args.max_bytes}:{},effective_max_bytes:effective};}
  const v={requestId:args.request_id,data:args.data};inputValid(v);await api('POST','/sessions/'+id+'/input',{actor:'agent',scope:grant.scope,ownerEpoch:grant.ownerEpoch,...v});check(c);if(agent(scope,id)!==grant)fail('terminal_scope_denied');return {accepted:true,sessionId:id};
 }
 // Cached readiness hint only: callTool remains the live lease/profile/source authority.
 function hasCurrentGrant(provider,sessionId){try{const selected=ownerScope(current());if(!selected||selected.provider!==provider)return false;for(const [id,grant]of grants){if(sessionId!==undefined&&sessionId!==id||grant.selectionRevision!==selectionRevision()||!resourceAllowed(id,grant.profile))continue;const s=known.get(id);if(equal(grant.scope,selected)&&s?.owner==='agent'&&s.ownerEpoch===grant.ownerEpoch&&s.alive===true&&!s.expired&&(!Number.isFinite(s.expiresAt)||s.expiresAt>Date.now())&&(!grant.source||grant.source===sourceStamp()))return true;}return false;}catch{return false;}}
 return {...Object.fromEntries(Object.entries({list,open,read,input,resize,owner,close,resourceState,callTool}).map(([k,v])=>[k,guarded(v)])),tools:()=>sharedTerminalTools,hasCurrentGrant,detach:()=>{}};
}
