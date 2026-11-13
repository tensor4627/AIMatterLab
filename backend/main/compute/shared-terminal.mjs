/** Main-only control bridge. Tokens, launch arguments and authentication bytes never enter MCP. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {computeRuntime} from '../../../desktop/platform/compute-runtime.mjs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {prepareTerminalRuntimeAsync,TERMINAL_RUNTIME_SCHEMA} from './terminal-runtime.mjs';
import {sshServiceEnvironmentGuide} from './ssh-service-environment-guide.mjs';
import {multiplexProfile} from '../../../desktop/platform/terminal-service/ssh-connection.mjs';

const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw Error(code);};
const readErrors={cursor:'terminal_invalid_request: cursor must be a non-negative integer sequence returned by read, or omitted.',maxBytes:'terminal_invalid_request: max_bytes must be a positive integer at most 65536, or omitted.'};
const codes=new Set(['terminal_invalid_request','terminal_unavailable','terminal_recovery_required','terminal_runtime_unavailable','terminal_runtime_low_integrity','terminal_runtime_execution_unavailable','terminal_start_failed','terminal_session_limit','terminal_session_exited','terminal_operation_failed','terminal_owner_changed','terminal_context_changed','terminal_human_owned','terminal_scope_denied','terminal_encryption_unavailable','terminal_saved_connection_changed','terminal_route_review_required','terminal_client_namespace_required','terminal_unknown_operation','terminal_service_active','terminal_service_unknown','terminal_service_unavailable','terminal_service_changed','terminal_service_failed',...Object.values(readErrors)]);
const brokerRefusals=new Map([['session_limit','terminal_session_limit'],['spawn_failed','terminal_start_failed'],['session_exited','terminal_session_exited'],['session_expired','terminal_session_exited'],['session_not_found','terminal_session_exited'],['owner_changed','terminal_owner_changed'],['human_owns_session','terminal_human_owned'],['agent_owns_session','terminal_human_owned'],['scope_mismatch','terminal_scope_denied'],...['invalid_request','invalid_scope','invalid_open','invalid_launch','invalid_expiry','invalid_cursor','invalid_input','request_changed','request_limit','invalid_size'].map(code=>[code,'terminal_invalid_request']),...['input_failed','resize_failed','close_failed'].map(code=>[code,'terminal_operation_failed'])]);
const safe=e=>codes.has(e?.message)?e.message:'terminal_unavailable';
for(const [code,safeCode]of Object.entries({service_active:'terminal_service_active',service_requires_ssh:'terminal_service_unavailable',service_unavailable:'terminal_service_unavailable',service_changed:'terminal_service_changed',service_busy:'terminal_service_active',service_protocol_failed:'terminal_service_failed',service_identity_failed:'terminal_service_failed',service_remote_failed:'terminal_service_failed',service_transport_unknown:'terminal_service_unknown',service_start_unknown:'terminal_service_unknown',service_request_unknown:'terminal_service_unknown',service_stop_unknown:'terminal_service_unknown',service_disconnected:'terminal_service_unavailable'}))brokerRefusals.set(code,safeCode);
brokerRefusals.set('service_reply_unavailable','terminal_service_unknown');
brokerRefusals.set('service_start_cancelled','terminal_service_changed');
codes.add('terminal_login_unknown');
const servicePhases=new Set(['preparing_environment','waiting_python','checking_cache','transferring_transport','transferring_worker','preparing_runtime','starting_worker','checking_health','ready','stopping','returning_terminal']);
const remoteServiceErrors=new Set(['environment_activation_failed','python_start_failed','python_response_timeout','python_unsupported','sqlite_unavailable','tty_unavailable','invalid_hello','protocol_failed','transport_hash_mismatch','transport_cache_invalid','worker_hash_mismatch','worker_cache_invalid','namespace_unsafe','permission_denied','storage_unavailable','worker_start_timeout','worker_start_failed','worker_identity_unavailable','worker_health_invalid','service_request_unconfirmed','internal_error']);
for(const code of ['ssh_connection_not_found','ssh_connection_changed','ssh_connection_limit','ssh_authentication_unconfirmed','ssh_authentication_not_pending','ssh_multiplex_unsupported','ssh_linux_client_namespace_required','ssh_route_requires_review','ssh_master_identity_changed','ssh_master_unavailable','ssh_control_identity_changed','ssh_control_unavailable','ssh_control_timeout','ssh_control_output_limit','ssh_channel_unavailable','ssh_close_unconfirmed','ssh_close_cleanup_unconfirmed','ssh_invalid_profile','ssh_client_unavailable']){codes.add(code);brokerRefusals.set(code,code);}
remoteServiceErrors.add('maintenance_required');
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
 if(!descriptorValid(d)||!/^\/(?:health|shutdown|connections(?:\/open|\/profile\/(?:prepare|commit|abort)|\/[A-Za-z0-9_-]+\/(?:state|confirm|login\/(?:complete|status\/[A-Za-z0-9_-]{1,100})|auth\/(?:read|input|resize)|shell\/open|close|service\/(?:start|state|request|stop|cancel)))?|sessions(?:\/[A-Za-z0-9_-]+(?:\/(?:state|read|input|resize|owner|close|service\/(?:start|request|stop|cancel|state)))?)?)$/.test(route))return reject(Error('terminal_unavailable'));
 const serviceRoute=route.includes('/service/'),loginRoute=route.endsWith('/login/complete'),transportError=()=>{const error=Error(serviceRoute?'terminal_service_unknown':loginRoute?'terminal_login_unknown':'terminal_unavailable');if(serviceRoute||loginRoute)error.terminalRejected=true;return error;};
 const data=body===undefined?undefined:JSON.stringify(body),req=http.request(d.origin+route,{method,headers:{Authorization:'Bearer '+d.controlToken,...data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}}},res=>{
  const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>(serviceRoute?8*1024*1024+65536:1024*1024)){res.destroy();reject(transportError());}else chunks.push(chunk);});
  res.on('error',()=>reject(transportError()));res.on('aborted',()=>reject(transportError()));res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(res.statusCode===200)return resolve(value);const code=brokerRefusals.get(value?.error);if(code&&[400,403,409,410,413,423,429,502,503].includes(res.statusCode)){const error=Error(code);error.terminalRejected=true;error.noSessionCreated=route==='/sessions/open'&&['session_limit','spawn_failed'].includes(value.error);return reject(error);}}catch{}reject(transportError());});
 });req.on('error',()=>reject(transportError()));req.setTimeout(loginRoute?60000:route.endsWith('/service/start')?150000:route.endsWith('/confirm')?20000:route.endsWith('/service/request')?260000:/\/service\/(stop|cancel)$/.test(route)?15000:5000,()=>{req.destroy();reject(transportError());});if(data)req.write(data);req.end();
});}
const safeState=s=>({id:s.id,sessionId:s.id,kind:s.kind,mode:s.mode,name:s.kind==='ssh'?'SSH terminal':'Local terminal',owner:s.owner,ownerEpoch:s.ownerEpoch,alive:s.alive===true,expired:s.expired===true,status:s.expired===true?'expired':s.alive===true?'running':s.alive===false?'exited':'unknown',sequence:s.sequence||0,serviceActive:s.serviceActive===true,serviceStatus:['idle','connecting','connected','disconnected','failed'].includes(s.serviceStatus)?s.serviceStatus:'idle',...Number.isInteger(s.exitCode)?{exitCode:s.exitCode}:{}});
function stateValid(s){return object(s)&&identifier(s.id)&&['local','ssh'].includes(s.kind)&&['interactive','key'].includes(s.mode)&&['human','agent'].includes(s.owner)&&Number.isSafeInteger(s.ownerEpoch)&&s.ownerEpoch>=0&&typeof s.alive==='boolean';}

export const sharedTerminalTools=Object.freeze([
 {name:'list_shared_terminals',description:'List only terminals the human explicitly handed to this current conversation. Cannot create terminals, change ownership, grant project access or establish scientific/job state.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'read_shared_terminal',description:'Read only post-handoff terminal output for this current conversation. Authentication and pre-handoff output are excluded. Reads preserve whole chunks: a positive max_bytes below 16384 uses a 16 KiB transport page, reported by effective_max_bytes; output is never truncated to the requested smaller budget. Continue with the returned sequence cursor, not a byte offset. A shared shell is not scientific validation or execution approval; formal calculations retain review/service gates. Never automatically resubmit an unknown run.',inputSchema:{type:'object',properties:{session_id:{type:'string'},cursor:{type:'integer',minimum:0,description:'Sequence cursor returned by the previous read; omit for the first read.'},max_bytes:{type:'integer',minimum:1,maximum:65536,description:'Desired positive page budget. Values below 16384 round up to 16384 to preserve complete transport chunks.'}},required:['session_id'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'write_shared_terminal',description:'Write bounded text to an existing terminal explicitly handed to this current conversation. No new session, handoff, approval or grant is provided. Use formal reviewed services for scientific execution; unknown runs must never be automatically resubmitted.',inputSchema:{type:'object',properties:{session_id:{type:'string'},request_id:{type:'string'},data:{type:'string',maxLength:8192}},required:['session_id','request_id','data'],additionalProperties:false},annotations:{readOnlyHint:false}}
]);

/** Sender validation remains in main.handle. Injected storage/transport keep unit checks local. */
export function createSharedTerminal({worker={},profiles,encryption,root,catalog,current=()=>null,settings=()=>({}),sourceGuard=()=>{},getSelectedResource=()=>null,selectionRevision=()=>0,runtimeRoot=path.join(root,'runtime'),dependencyRoot,servicePath=computeRuntime.terminalServicePath,nodeExecutable=process.execPath,prepareRuntime=prepareTerminalRuntimeAsync,spawn=computeRuntime.spawnProcess,requestApi=localRequest,platform=process.platform,env=process.env,uuid=randomUUID,secret=()=>randomBytes(32).toString('hex'),readyTimeoutMs=10000,desktopSessionId=randomUUID()}){
 if(!path.isAbsolute(root)||!path.isAbsolute(runtimeRoot)||!text(dependencyRoot,4096)||!path.isAbsolute(dependencyRoot)||!path.isAbsolute(servicePath)||!path.isAbsolute(nodeExecutable))fail('terminal_invalid_request');
 if(!identifier(desktopSessionId))fail('terminal_invalid_request');
 const registryFile=path.join(root,'brokers-v2-'+desktopSessionId+'.bin'),known=new Map(),connectionKnown=new Map(),connectionOpening=new Map(),grants=new Map(),opening=new Map(),pendingProfiles=new Map(),uncertain=new Set(),ownershipIntents=new Map(),registered=new Map(),available=new Map(),children=new Map(),serviceReservations=new Map(),serviceAttempts=new Map(),services=new Map(),serviceNotStartedErrors=new WeakSet(),profileEnvironmentUpdates=new WeakMap();let daemon=null,booting=null,restoring=null,loaded=false,activeId=null,ownershipSerial=0,closing=false,shutdownPromise=null;
 const assertLive=()=>{if(closing)fail('terminal_context_changed');};
 function archive(kind,record,reason,extra={}){catalog?.put?.(kind+'-archive',record.id,{...record,...extra,archiveSchemaVersion:2,archivedAt:Date.now(),archiveReason:reason});catalog?.remove?.(kind,record.id);}
 const beginOwnership=id=>{const serial=++ownershipSerial;ownershipIntents.set(id,serial);if(ownershipIntents.size>64)ownershipIntents.delete(ownershipIntents.keys().next().value);return ()=>{if(ownershipIntents.get(id)!==serial)fail('terminal_context_changed');};};
 for(const record of catalog?.list?.('shared-terminal')||[])if(identifier(record.id)){if(record.desktopSessionId===desktopSessionId)known.set(record.id,{...record,alive:undefined});else archive('shared-terminal',record,'previous-desktop');}
 for(const record of catalog?.list?.('shared-terminal-pending')||[])if(identifier(record.id)){if(record.desktopSessionId===desktopSessionId){uncertain.add(record.id);if(identifier(record.profileId))pendingProfiles.set(record.id,record.profileId);}else archive('shared-terminal-pending',record,'previous-desktop');}
 const snapshot=(independent=false)=>({independent,selection:structuredClone(current()),resourceRevision:selectionRevision(),connection:worker.connection,epoch:worker.connectionEpoch,identity:structuredClone(worker.identity),target:structuredClone(worker.connectionTarget),source:worker.connectedSource});
 const check=c=>{assertLive();if(c.resourceRevision!==selectionRevision()||!equal(c.selection,current())||!c.independent&&(c.connection!==worker.connection||c.epoch!==worker.connectionEpoch||!equal(c.identity,worker.identity)||!equal(c.target,worker.connectionTarget)||c.source!==worker.connectedSource))fail('terminal_context_changed');};
 const resourceAllowed=(id,profile)=>{const selected=getSelectedResource();if(selected?.kind==='ssh-connection'){const entry=known.get(id),connection=connectionKnown.get(entry?.connectionId);return !!(entry?.connectionId===selected.connectionId&&profile?.connectionId===selected.connectionId&&profile?.profileId===selected.profileId&&profile.version===selected.profileVersion&&connection?.status==='authenticated'&&connection.authentication==='verified');}return !selected||selected.kind==='ssh-terminal'&&selected.sessionId===id&&profile?.profileId===selected.profileId&&profile.version===selected.profileVersion;};
 const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const sourceStamp=()=>digest([worker.identity,worker.connectionTarget,worker.connectedSource]);const grantContext=()=>{const c=current()||{};return Object.fromEntries(['provider','threadId','taskId','projectId','environmentId','inputRoot'].map(k=>[k,c[k]??null]));};const currentGrant=g=>g&&equal(g.context,grantContext());
 function registryLaunch(profileId,version,mode){let p;try{p=profiles?.read({id:profileId,version});}catch{fail('terminal_saved_connection_changed');}if(!p||p.id!==profileId||p.version!==version||p.kind!=='ssh'||p.mode!==mode)fail('terminal_saved_connection_changed');const launch=buildTerminalLaunch(p,mode,{...settings(),platform,distribution:p.distribution,systemRoot:env.SystemRoot||env.WINDIR});return {launch,proof:{profileId,version,planHash:digest(launch)}};}
 function checkProfile(proof,mode){if(proof?.connectionId){const p=readConnectionProfile(proof.profileId,proof.version);if(connectionProfileHash(p)!==proof.planHash||connectionKnown.get(proof.connectionId)?.profileVersion!==proof.version)fail('terminal_saved_connection_changed');return;}if(proof)readConnectionProfile(proof.profileId,proof.version,true);if(!proof||!equal(registryLaunch(proof.profileId,proof.version,mode).proof,proof))fail('terminal_saved_connection_changed');}
 const describe=s=>{const entry=known.get(s.id),profile=entry?.profile;if(entry?.connectionId)return {...safeState(s),connectionId:entry.connectionId,resource:{kind:'ssh-connection',connectionId:entry.connectionId,profileId:profile?.profileId,profileVersion:profile?.version}};return {...safeState(s),...s.kind==='ssh'&&profile?{resource:{kind:'ssh-terminal',profileId:profile.profileId,profileVersion:profile.version}}:{}};};
 const remember=(s,broker=daemon)=>{assertLive();if(!stateValid(s))fail('terminal_unavailable');known.set(s.id,{...known.get(s.id),id:s.id,...s.connectionId?{connectionId:s.connectionId}:{},desktopSessionId,kind:s.kind,mode:s.mode,owner:s.owner,ownerEpoch:s.ownerEpoch,alive:s.alive,expired:s.expired===true,serviceActive:s.serviceActive===true,serviceStatus:s.serviceStatus,...broker?{brokerId:broker.instanceId}:{},...Number.isFinite(s.expiresAt)?{expiresAt:s.expiresAt}:{},sequence:s.sequence||0,exitCode:s.exitCode});catalog?.put?.('shared-terminal',s.id,known.get(s.id));return describe(s);};
 const unknown=()=>[...known.values()].map(s=>({...describe(s),alive:null,status:'unknown',owner:'human'}));
 const encrypted=()=>{if(!encryption?.isEncryptionAvailable?.())fail('terminal_encryption_unavailable');};
 function writeEncrypted(file,value){encrypted();checkAncestors(root);fs.mkdirSync(root,{recursive:true,mode:0o700});if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))fail('terminal_unavailable');const tmp=file+'.'+uuid()+'.tmp';try{fs.writeFileSync(tmp,encryption.encryptString(JSON.stringify(value)),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
 function readEncrypted(file){encrypted();checkAncestors(root);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>262144)fail('terminal_unavailable');return JSON.parse(encryption.decryptString(fs.readFileSync(file)));}
 function load(forShutdown=false){if(!forShutdown)assertLive();if(loaded)return;let records=[],id=null;if(fs.existsSync(registryFile)){const index=readEncrypted(registryFile);if(index?.schema_version!==2||index.desktop_session_id!==desktopSessionId||!Array.isArray(index.brokers)||index.brokers.length>32||index.brokers.some(d=>!descriptorValid(d)||d.desktopSessionId!==desktopSessionId)||new Set(index.brokers.map(d=>d.instanceId)).size!==index.brokers.length||!index.closed&&(!text(index.active_instance_id)||!index.brokers.some(d=>d.instanceId===index.active_instance_id)))fail('terminal_unavailable');if(!index.closed){records=index.brokers;id=index.active_instance_id;}}for(const d of records)registered.set(d.instanceId,d);activeId=id;loaded=true;}
 const durable=d=>d?.runtime?.schema===TERMINAL_RUNTIME_SCHEMA&&/^[a-f0-9]{64}$/.test(d.runtime.id||'');
 const save=d=>{assertLive();load();if(d.desktopSessionId!==desktopSessionId||!registered.has(d.instanceId)&&registered.size>=32)fail('terminal_unavailable');const all=new Map(registered);all.set(d.instanceId,d);writeEncrypted(registryFile,{schema_version:2,desktop_session_id:desktopSessionId,active_instance_id:d.instanceId,brokers:[...all.values()]});registered.set(d.instanceId,d);available.set(d.instanceId,d);activeId=d.instanceId;};
 function brokerFor(route){const connection=/^\/connections\/([^/]+)\//.exec(route),connectionBroker=connection&&connectionKnown.get(connection[1])?.brokerId;if(connectionBroker)return available.get(connectionBroker);const match=/^\/sessions\/([^/]+)\//.exec(route),id=match&&known.get(match[1])?.brokerId;return id?available.get(id):daemon;}
 const rpc=(method,route,body,broker=brokerFor(route))=>{if(!broker)fail('terminal_unavailable');return requestApi(broker,method,route,body);};
 async function restore(){
  if(restoring)return restoring;
  const operation=(async()=>{load();await Promise.all([...registered.values()].filter(d=>!available.has(d.instanceId)).map(async d=>{try{const h=await requestApi(d,'GET','/health');assertLive();if(h?.instanceId!==d.instanceId||h.pid!==d.pid)return;const response=await rpc('GET','/sessions',undefined,d);assertLive();const list=Array.isArray(response)?response:response.sessions;if(!Array.isArray(list)||list.length>16)fail('terminal_unavailable');for(const s of list){if(!stateValid(s))fail('terminal_unavailable');if(s.owner==='agent'&&s.alive&&!s.expired)remember(await rpc('POST','/sessions/'+s.id+'/owner',{owner:'human',ownerEpoch:s.ownerEpoch},d),d);else remember(s,d);}assertLive();available.set(d.instanceId,d);}catch{available.delete(d.instanceId);}}));assertLive();daemon=available.get(activeId)||[...available.values()].at(-1)||null;return !!daemon;})();restoring=operation;try{return await operation;}finally{if(restoring===operation)restoring=null;}
 }
 async function start(){
  assertLive();encrypted();checkAncestors(runtimeRoot);fs.mkdirSync(runtimeRoot,{recursive:true,mode:0o700});const run=path.join(runtimeRoot,uuid());fs.mkdirSync(run,{mode:0o700});const controlToken=secret(),instanceId=uuid();
  let stable;try{stable=await prepareRuntime({runtimeRoot:path.join(runtimeRoot,'generations'),nodeExecutable,servicePath,dependencyRoot,platform});}catch(error){assertLive();fail(['terminal_runtime_low_integrity','terminal_runtime_execution_unavailable'].includes(error?.message)?error.message:'terminal_runtime_unavailable');}assertLive();
  let child;try{child=spawn(stable.nodeExecutable,[stable.servicePath],{cwd:path.dirname(stable.servicePath),detached:true,windowsHide:true,env:terminalChildEnvironment(env),stdio:['pipe','pipe','ignore']});}catch{fail('terminal_start_failed');}
  const discard=()=>{try{child.kill?.();}catch{}child.stdin?.destroy?.();child.stdout?.destroy?.();child.unref?.();};
  const tracked={child,exited:false,exit:null};tracked.exit=new Promise(resolve=>child.once('exit',()=>{tracked.exited=true;resolve();}));children.set(instanceId,tracked);
  let ready;try{ready=await new Promise((resolve,reject)=>{let buffer='',done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);child.stdout?.removeListener('data',onData);error?reject(Error('terminal_start_failed')):resolve(value);};const onData=chunk=>{buffer+=chunk.toString('utf8');if(Buffer.byteLength(buffer)>4096)return finish(true);if(buffer.includes('\n')){try{const value=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));if(value?.instanceId!==instanceId||value.pid!==child.pid)return finish(true);finish(false,value);}catch{finish(true);}}};const timer=setTimeout(()=>finish(true),readyTimeoutMs);child.once('error',()=>finish(true));child.once('exit',()=>finish(true));child.stdout.on('data',onData);child.stdin.on('error',()=>finish(true));child.stdin.end(JSON.stringify({controlToken,instanceId,runtimeRoot:run,dependencyRoot:stable.dependencyRoot})+'\n');});}catch(error){discard();throw error;}
  const d={...ready,controlToken,runtimeRoot:run,runtime:stable.receipt,desktopSessionId};try{assertLive();if(!descriptorValid(d))fail('terminal_start_failed');save(d);}catch(error){discard();throw error;}daemon=d;child.stdout?.destroy();child.unref?.();return true;
 }
 async function ensure(create=false,fresh=false){assertLive();if(daemon&&(!fresh||durable(daemon)))return true;if(booting){await booting;assertLive();if(daemon&&(!fresh||durable(daemon)))return true;}booting=(async()=>{if(await restore()&&(!fresh||durable(daemon)))return true;return create?start():false;})();try{return await booting;}finally{booting=null;}}
 async function api(method,route,body,broker=brokerFor(route)){assertLive();try{const value=await rpc(method,route,body,broker);assertLive();return value;}catch(error){assertLive();if(error.terminalRejected)throw error;if(broker){available.delete(broker.instanceId);if(daemon===broker)daemon=null;for(const [id,value]of known)if(value.brokerId===broker.instanceId){known.set(id,{...value,alive:undefined});grants.delete(id);}}fail('terminal_unavailable');}}
 async function state(id){if(known.get(id)?.connectionId){const parent=await connectionState({connectionId:known.get(id).connectionId});if(parent.status!=='authenticated'||parent.authentication!=='verified')fail('ssh_authentication_unconfirmed');}if(!identifier(id)||!await ensure())fail('terminal_unavailable');const wanted=known.get(id)?.brokerId;if(wanted&&!available.has(wanted))await restore();const route='/sessions/'+id+'/state',broker=brokerFor(route),s=await api('GET',route,undefined,broker);remember(s,broker);return s;}
 const guarded=fn=>async(...args)=>{try{assertLive();return await fn(...args);}catch(e){const error=Error(safe(e));if(serviceNotStartedErrors.has(e))error.serviceNotStarted=true;throw error;}};
 const guardedSync=fn=>(...args)=>{try{assertLive();return fn(...args);}catch(error){throw Error(safe(error));}};
 async function list(data={}){typed(data,[]);const c=snapshot();if(booting)await booting;await restore();check(c);const items=[];for(const d of [...available.values()])try{const response=await api('GET','/sessions',undefined,d),rows=Array.isArray(response)?response:response.sessions;if(!Array.isArray(rows)||rows.length>16)fail('terminal_unavailable');items.push(...rows.map(s=>remember(s,d)));}catch(error){if(error.message!=='terminal_unavailable')throw error;}check(c);return {sessions:[...items,...unknown().filter(s=>!items.some(t=>t.id===s.id))]};}
 async function openOnce(data,routeKey,baseRouteKey){const independent=data.profileId!==undefined,c=snapshot(independent),source=data.kind==='ssh'&&!independent?sourceStamp():null;let launch,launchSettings,profileProof;
  if(independent){if(!identifier(data.profileId)||!Number.isInteger(data.version)||data.version<1)fail('terminal_saved_connection_changed');readConnectionProfile(data.profileId,data.version,true);const planned=registryLaunch(data.profileId,data.version,data.mode);launch=planned.launch;profileProof=planned.proof;}
  else if(data.kind==='ssh'){if(!identifier(data.clusterId)||!Number.isInteger(data.version)||data.version<1||!worker.connection)fail('terminal_saved_connection_changed');sourceGuard();const profile=await worker.request('POST','/api/cluster/profile',{cluster_id:data.clusterId});check(c);sourceGuard();if(profile?.id!==data.clusterId||profile.version!==data.version)fail('terminal_saved_connection_changed');launchSettings={...settings(),platform,distribution:worker.identity?.distribution,systemRoot:env.SystemRoot||env.WINDIR};launch=buildTerminalLaunch(profile,data.mode,launchSettings);}
  else launch=localLaunch(settings(),platform,env);
  if(data.newConnection){await ensure(true,true);}else if(!await ensure(false)){check(c);if([...known.values()].some(s=>s.routeKey===routeKey)||uncertain.has(routeKey))fail('terminal_recovery_required');await ensure(true);}check(c);
  const all=await list({});check(c);const items=all.sessions;
  if(profileProof)checkProfile(profileProof,data.mode);
  for(const item of items){const record=known.get(item.id);if(data.newConnection&&record?.routeKey===routeKey)return item;if(item.alive===true&&(record?.routeKey===routeKey||!data.newConnection&&record?.baseRouteKey===baseRouteKey))return item;}
  if(!data.newConnection&&(!durable(daemon)||uncertain.has(routeKey)))fail('terminal_recovery_required');
  if(uncertain.has(routeKey))fail('terminal_recovery_required');
  if(items.filter(s=>s.alive===true).length>=4)fail('terminal_session_limit');
  if(data.kind==='ssh'&&!independent){const latest=await worker.request('POST','/api/cluster/profile',{cluster_id:data.clusterId});check(c);sourceGuard();if(latest?.id!==data.clusterId||latest.version!==data.version||!equal(buildTerminalLaunch(latest,data.mode,launchSettings),launch))fail('terminal_saved_connection_changed');}
  const selectedBroker=daemon;if(!selectedBroker||!durable(selectedBroker)||available.get(selectedBroker.instanceId)!==selectedBroker)fail('terminal_recovery_required');
  launch.env=terminalEnvironment(env,platform);uncertain.add(routeKey);catalog?.put?.('shared-terminal-pending',routeKey,{status:'unknown',desktopSessionId,...profileProof?{profileId:profileProof.profileId}:{}});
  let s;try{s=await api('POST','/sessions/open',{kind:data.kind,mode:data.mode,name:data.kind==='ssh'?'SSH terminal':'Local terminal',launch},selectedBroker);}catch(error){if(error.noSessionCreated){uncertain.delete(routeKey);catalog?.remove?.('shared-terminal-pending',routeKey);}throw error;}
  remember(s,selectedBroker);known.set(s.id,{...known.get(s.id),source,routeKey,baseRouteKey,...profileProof?{profile:profileProof}:{}});catalog?.put?.('shared-terminal',s.id,known.get(s.id));uncertain.delete(routeKey);catalog?.remove?.('shared-terminal-pending',routeKey);check(c);if(profileProof)checkProfile(profileProof,data.mode);return describe(s);
 }
 async function open(data){typed(data,['kind','mode','clusterId','profileId','version','newConnection','requestId']);if(!['local','ssh'].includes(data.kind)||!['interactive','key'].includes(data.mode)||data.profileId!==undefined&&(data.kind!=='ssh'||data.clusterId!==undefined)||data.newConnection!==undefined&&data.newConnection!==true||data.newConnection===true&&!identifier(data.requestId)||data.newConnection!==true&&data.requestId!==undefined)fail('terminal_invalid_request');if(data.kind==='local'&&(data.clusterId!==undefined||data.profileId!==undefined||data.version!==undefined))fail('terminal_invalid_request');const target=data.profileId!==undefined?['desktop-profile',data.profileId,data.version,data.mode]:[data.kind,data.mode,data.clusterId||null,data.version||null,data.kind==='ssh'?sourceStamp():null],baseRouteKey=digest(['desktop-terminal-v2',desktopSessionId,target]),routeKey=data.newConnection?digest(['explicit-new-terminal',baseRouteKey,data.requestId]):baseRouteKey;if(opening.has(routeKey))return opening.get(routeKey);if(identifier(data.profileId))pendingProfiles.set(routeKey,data.profileId);const promise=openOnce(data,routeKey,baseRouteKey);opening.set(routeKey,promise);try{return await promise;}finally{if(opening.get(routeKey)===promise)opening.delete(routeKey);if(!uncertain.has(routeKey))pendingProfiles.delete(routeKey);}}
 async function ownedHuman(data,keys){typed(data,['sessionId',...keys]);const c=snapshot(!!known.get(data.sessionId)?.profile);const s=await state(data.sessionId);check(c);return {c,s};}
 function boundsRead(data){if(data.cursor!==undefined)epoch(data.cursor);if(data.maxBytes!==undefined&&(!Number.isInteger(data.maxBytes)||data.maxBytes<16384||data.maxBytes>65536))fail('terminal_invalid_request');}
 function inputValid(data){if(typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.requestId)||typeof data.data!=='string'||!data.data||Buffer.byteLength(data.data)>8192)fail('terminal_invalid_request');}
 function readResult(r,id){if(!object(r)||!stateValid(r.state)||r.state.id!==id||!Array.isArray(r.chunks)||r.chunks.length>512||r.chunks.some(c=>!Number.isSafeInteger(c.sequence)||typeof c.data!=='string')||r.chunks.reduce((n,c)=>n+Buffer.byteLength(c.data),0)>262144||!Number.isSafeInteger(r.cursor))fail('terminal_unavailable');return {...remember(r.state,brokerFor('/sessions/'+id+'/read')),chunks:r.chunks.map(c=>({sequence:c.sequence,data:c.data})),output:r.chunks.map(c=>c.data).join(''),cursor:r.cursor,dropped:r.dropped===true};}
 async function read(data){boundsRead(data);epoch(data.ownerEpoch);const {c,s}=await ownedHuman(data,['ownerEpoch','cursor','maxBytes']);const r=await api('POST','/sessions/'+s.id+'/read',{actor:'human',ownerEpoch:data.ownerEpoch,...data.cursor!==undefined?{cursor:data.cursor}:{},...data.maxBytes?{maxBytes:data.maxBytes}:{}});check(c);return readResult(r,s.id);}
 async function input(data){inputValid(data);epoch(data.ownerEpoch);if(serviceReservations.has(data.sessionId))fail('terminal_service_active');const {c,s}=await ownedHuman(data,['ownerEpoch','requestId','data']);if(serviceReservations.has(data.sessionId)||s.serviceActive)fail('terminal_service_active');if(s.owner!=='human')fail('terminal_human_owned');await api('POST','/sessions/'+s.id+'/input',{actor:'human',ownerEpoch:data.ownerEpoch,requestId:data.requestId,data:data.data});check(c);return {accepted:true,sessionId:s.id};}
 async function resize(data){if(serviceReservations.has(data.sessionId))fail('terminal_service_active');if(!Number.isInteger(data.cols)||data.cols<10||data.cols>500||!Number.isInteger(data.rows)||data.rows<2||data.rows>300)fail('terminal_invalid_request');const {c,s}=await ownedHuman(data,['cols','rows']);if(serviceReservations.has(data.sessionId)||s.serviceActive)fail('terminal_service_active');await api('POST','/sessions/'+s.id+'/resize',{actor:'human',ownerEpoch:s.ownerEpoch,cols:data.cols,rows:data.rows});check(c);return {accepted:true};}
 async function owner(data,options={}){if(!object(options)||Object.keys(options).some(key=>key!=='assertCurrent')||options.assertCurrent!==undefined&&typeof options.assertCurrent!=='function')fail('terminal_invalid_request');const assertHandoff=()=>{try{options.assertCurrent?.();}catch{fail('terminal_context_changed');}};assertHandoff();typed(data,['sessionId','ownerEpoch','owner']);epoch(data.ownerEpoch);if(serviceReservations.has(data.sessionId))fail('terminal_service_active');if(!['human','agent'].includes(data.owner))fail('terminal_invalid_request');const assertOwnership=beginOwnership(data.sessionId);grants.delete(data.sessionId);const {c,s}=await ownedHuman(data,['ownerEpoch','owner']),profile=known.get(s.id)?.profile;assertOwnership();assertHandoff();if(serviceReservations.has(data.sessionId)||s.serviceActive)fail('terminal_service_active');const scope=data.owner==='agent'?ownerScope(current()):null;if(data.owner==='agent'){if(!scope||!resourceAllowed(s.id,profile))fail('terminal_scope_denied');if(profile)checkProfile(profile,s.mode);else if(s.kind==='ssh'&&known.get(s.id)?.source!==sourceStamp())fail('terminal_scope_denied');}const route='/sessions/'+s.id+'/owner',broker=brokerFor(route),updated=await api('POST',route,{owner:data.owner,ownerEpoch:data.ownerEpoch,...scope?{scope}:{}},broker);check(c);assertOwnership();assertHandoff();const result=remember(updated,broker);if(scope){if(profile)checkProfile(profile,s.mode);grants.set(s.id,{scope,context:grantContext(),ownerEpoch:updated.ownerEpoch,selectionRevision:selectionRevision(),source:known.get(s.id).source,...profile?{profile:structuredClone(profile)}:{}});}return result;}
 async function close(data){typed(data,['sessionId']);const assertOwnership=beginOwnership(data.sessionId);grants.delete(data.sessionId);const {c,s}=await ownedHuman(data,[]);assertOwnership();await api('POST','/sessions/'+s.id+'/close',{actor:'human',ownerEpoch:s.ownerEpoch});check(c);assertOwnership();known.delete(s.id);services.delete(s.id);catalog?.remove?.('shared-terminal',s.id);return {closed:true,sessionId:s.id};}
 // These service methods are main-only ports. They are deliberately absent from
 // the renderer terminal operations and from the three shared-terminal tools.
 function serviceProfile(id){
  const entry=known.get(id),proof=entry?.profile;
  if(!identifier(id)||entry?.desktopSessionId!==desktopSessionId||entry.kind!=='ssh'||!proof)fail('terminal_saved_connection_changed');
  checkProfile(proof,entry.mode);if(!resourceAllowed(id,proof))fail('terminal_scope_denied');return proof;
 }
 // Cleanup is an exact capability for the original desktop/session/broker, not
 // authority to operate whichever compute resource is selected now.
 function serviceCleanupTarget(sessionId,target){
  assertLive();const entry=known.get(sessionId),broker=target&&available.get(target.brokerId);
  if(!target||target.sessionId!==sessionId||target.desktopSessionId!==desktopSessionId||entry?.desktopSessionId!==desktopSessionId||entry.kind!=='ssh'||entry.brokerId!==target.brokerId||!equal(entry.profile,target.proof))fail('terminal_service_changed');
  if(!broker||broker.desktopSessionId!==desktopSessionId)fail('terminal_service_unavailable');
  return {proof:target.proof,broker};
 }
 function serviceWasNotStarted(data,ownedReservation){
  if(!identifier(data?.sessionId)||!identifier(data?.requestId)||data.requestId.length>100)return false;
  const entry=known.get(data.sessionId),attempt=serviceAttempts.get(data.sessionId+':'+data.requestId),reservation=serviceReservations.get(data.sessionId);
  if(entry?.desktopSessionId!==desktopSessionId||entry.kind!=='ssh'||!entry.profile||entry.serviceActive===true||services.has(data.sessionId)||reservation&&reservation!==ownedReservation||attempt?.dispatched===true||ownedReservation?.dispatched===true)return false;
  // Another unresolved POST on the same terminal also prevents an available
  // claim, even when this new request failed before its own dispatch.
  return ![...serviceAttempts.values()].some(value=>value.sessionId===data.sessionId&&value.dispatched&&!value.released);
 }
 function readConnectionProfile(profileId,version,latest=false){let p;try{p=profiles.read(latest?{id:profileId}:{id:profileId,version});}catch{fail('terminal_saved_connection_changed');}if(p?.id!==profileId||p.version!==version||p.kind!=='ssh')fail('terminal_saved_connection_changed');return p;}
 const connectionProfileHash=profile=>digest([multiplexProfile(profile),profile.distribution||null,profile.mode]);
 function validateConnectionView(value,broker){
  if(value?.loginRequestId!==undefined&&!identifier(value.loginRequestId))fail("terminal_unavailable");
  if(!object(value)||value.schemaVersion!==2||!identifier(value.connectionId)||!identifier(value.profileId)||!Number.isSafeInteger(value.profileVersion)||value.profileVersion<1||!['authenticating','authenticated','unavailable','closed','requires_review','unsupported'].includes(value.status)||!['pending','verified','not_observed','lost'].includes(value.authentication)||typeof value.capabilities?.multiplex!=='boolean'||!Array.isArray(value.terminalSessionIds)||value.terminalSessionIds.length>32||!Array.isArray(value.serviceIds)||value.serviceIds.length>1||!Number.isSafeInteger(value.revision)||value.revision<1||value.closed!==undefined&&typeof value.closed!=='boolean')fail('terminal_unavailable');
  for(const ids of [value.terminalSessionIds,value.serviceIds])if(ids.some(item=>!identifier(item))||new Set(ids).size!==ids.length)fail('terminal_unavailable');
  const previous=connectionKnown.get(value.connectionId);if(previous&&(value.revision<previous.revision||previous.profileId!==value.profileId||broker?.instanceId&&previous.brokerId!==broker.instanceId))fail('ssh_connection_changed');
 }
 function connectionView(value,broker){validateConnectionView(value,broker);const safe={schemaVersion:2,connectionId:value.connectionId,profileId:value.profileId,profileVersion:value.profileVersion,status:value.status,authentication:value.authentication,capabilities:{multiplex:value.capabilities.multiplex},...value.loginRequestId?{loginRequestId:value.loginRequestId}:{},terminalSessionIds:[...value.terminalSessionIds],serviceIds:[...value.serviceIds],revision:value.revision,...value.closed!==undefined?{closed:value.closed}:{},...value.error&&/^ssh_[a-z_]+$/.test(value.error.code||'')?{error:{code:value.error.code}}:{}};connectionKnown.set(value.connectionId,{...safe,brokerId:broker?.instanceId||connectionKnown.get(value.connectionId)?.brokerId});if(safe.status!=='authenticated')for(const [id,entry]of known)if(entry.connectionId===safe.connectionId)grants.delete(id);return safe;}

 async function connectionBroker(data){typed(data,['connectionId']);if(!identifier(data.connectionId))fail('terminal_invalid_request');if(!await ensure())fail('terminal_unavailable');if(!connectionKnown.has(data.connectionId))await connectionList({});const record=connectionKnown.get(data.connectionId),broker=record&&available.get(record.brokerId);if(!broker)fail('ssh_connection_not_found');return {record,broker};}
 async function connectionList(data={}){
  typed(data,[]);await restore();const brokers=[...available.values()];if(brokers.length>32)fail('terminal_unavailable');const rows=[],ids=new Set(),channels=new Map();
  for(const broker of brokers){const response=await api('GET','/connections',undefined,broker);if(!Array.isArray(response?.connections)||response.connections.length>64||rows.length+response.connections.length>32*64)fail('terminal_unavailable');for(const value of response.connections){validateConnectionView(value,broker);if(ids.has(value.connectionId))fail('terminal_unavailable');ids.add(value.connectionId);for(const [kind,list]of [['shell',value.terminalSessionIds],['service',value.serviceIds]])for(const id of list){const key=kind+':'+id;if(channels.has(key))fail('terminal_unavailable');channels.set(key,value.connectionId);}rows.push({value,broker});}}
  return {connections:rows.map(({value,broker})=>connectionView(value,broker))};
 }

 async function connectionOpen(data){typed(data,['profileId','profileVersion','requestId']);if(!identifier(data.profileId)||!identifier(data.requestId)||!Number.isSafeInteger(data.profileVersion)||data.profileVersion<1)fail('terminal_invalid_request');const signature=digest(data),old=connectionOpening.get(data.requestId);if(old){if(old.signature!==signature)fail('terminal_invalid_request');return old.promise;}const profile=readConnectionProfile(data.profileId,data.profileVersion,true),key='connection-'+data.requestId;pendingProfiles.set(key,data.profileId);const promise=(async()=>{await ensure(true,true);readConnectionProfile(data.profileId,data.profileVersion,true);const broker=daemon,value=await api('POST','/connections/open',{...data,profile},broker),view=connectionView(value,broker);const latest=profiles.read({id:data.profileId});if(latest.version!==data.profileVersion){await api('POST','/connections/'+view.connectionId+'/close',{},broker);fail('terminal_saved_connection_changed');}return view;})();connectionOpening.set(data.requestId,{signature,promise});try{return await promise;}finally{pendingProfiles.delete(key);}}
 async function connectionState(data){const {record,broker}=await connectionBroker(data);if(record.status==='authenticating'){const latest=profiles.read({id:record.profileId});if(latest.version!==record.profileVersion){await api('POST','/connections/'+record.connectionId+'/close',{},broker);connectionKnown.set(record.connectionId,{...record,status:'requires_review',authentication:'lost'});fail('terminal_saved_connection_changed');}}return connectionView(await api('GET','/connections/'+data.connectionId+'/state',undefined,broker),broker);}
 async function connectionOperation(data,operation,keys=[]){typed(data,['connectionId',...keys]);const {record,broker}=await connectionBroker({connectionId:data.connectionId});if(record.status==='authenticating'&&operation!=='close'){try{readConnectionProfile(record.profileId,record.profileVersion,true);}catch(error){const stopped=await api('POST','/connections/'+record.connectionId+'/close',{},broker);connectionView(stopped,broker);throw error;}}const {connectionId,...body}=data,result=await api('POST','/connections/'+connectionId+'/'+operation,body,broker);if(['confirm','close'].includes(operation))return connectionView(result,broker);if(operation==='auth/read'){if(typeof result?.output!=='string'||Buffer.byteLength(result.output)>65536||result.connectionId!==connectionId)fail('terminal_unavailable');return {...result,state:connectionView(result.state,broker)};}return result;}
 async function connectionOpenShell(data){typed(data,['connectionId','requestId']);const {record,broker}=await connectionBroker({connectionId:data.connectionId}),profile=readConnectionProfile(record.profileId,record.profileVersion),proof={profileId:profile.id,version:profile.version,connectionId:record.connectionId,planHash:connectionProfileHash(profile)};const s=await connectionOperation(data,'shell/open',['requestId']);if(s.connectionId!==record.connectionId)fail('terminal_unavailable');remember(s,broker);known.set(s.id,{...known.get(s.id),profile:proof,source:null});catalog?.put?.('shared-terminal',s.id,known.get(s.id));return describe(s);}
 function acceptLoginResult(data,result,broker,proof,requireStatus=false){
  if(result?.connection?.connectionId!==data.connectionId)fail('ssh_connection_changed');
  const connection=connectionView(result.connection,broker);
  if(connection.profileId!==proof.profileId||connection.profileVersion!==proof.version||connection.loginRequestId&&connection.loginRequestId!==data.requestId)fail('terminal_saved_connection_changed');
  const login=result.login;
  if(requireStatus&&!login||login&&(!object(login)||!['waiting_authentication','checking','complete','failed'].includes(login.status)||login.phase!==undefined&&!['waiting_authentication','checking_authentication','opening_shell'].includes(login.phase)||login.code!==undefined&&!/^ssh_[a-z_]{1,100}$/.test(login.code)&&!['terminal_unavailable','terminal_session_limit','terminal_start_failed','terminal_service_active'].includes(login.code)))fail('terminal_unavailable');
  const safeLogin=login?{login:{status:login.status,...login.phase?{phase:login.phase}:{},...login.code?{code:login.code}:{}}}:{};
  if(!result.shell)return {connection,...safeLogin};
  const shell=result.shell;
  if(connection.authentication!=='verified'||connection.status!=='authenticated'||shell.connectionId!==data.connectionId||!connection.terminalSessionIds.includes(shell.id))fail('ssh_connection_changed');
  remember(shell,broker);known.set(shell.id,{...known.get(shell.id),profile:proof,source:null});catalog?.put?.('shared-terminal',shell.id,known.get(shell.id));
  return {connection,shell:describe(shell),...safeLogin};
 }
 async function connectionCompleteLogin(data){
  typed(data,['connectionId','requestId']);if(!identifier(data.requestId))fail('terminal_invalid_request');
  const {record,broker}=await connectionBroker({connectionId:data.connectionId}),profile=readConnectionProfile(record.profileId,record.profileVersion,record.status==='authenticating'),proof={profileId:profile.id,version:profile.version,connectionId:record.connectionId,planHash:connectionProfileHash(profile)};
  return acceptLoginResult(data,await connectionOperation(data,'login/complete',['requestId']),broker,proof);
 }
 async function connectionLoginStatus(data){
  typed(data,['connectionId','requestId']);if(!identifier(data.requestId))fail('terminal_invalid_request');
  const {record,broker}=await connectionBroker({connectionId:data.connectionId}),profile=readConnectionProfile(record.profileId,record.profileVersion),proof={profileId:profile.id,version:profile.version,connectionId:record.connectionId,planHash:connectionProfileHash(profile)};
  const result=await api('GET','/connections/'+data.connectionId+'/login/status/'+data.requestId,undefined,broker);
  return acceptLoginResult(data,result,broker,proof,true);
 }
 async function connectionClose(data){const {record,broker}=await connectionBroker(data);const value=await api('POST','/connections/'+record.connectionId+'/close',{},broker),view=connectionView(value,broker);for(const id of value.closedSessionIds||[]){beginOwnership(id);grants.delete(id);known.delete(id);catalog?.remove?.('shared-terminal',id);}return {...view,closed:value.closed===true,closedSessionIds:value.closedSessionIds||[],closedServiceIds:value.closedServiceIds||[]};}
 async function connectionServiceState(data){typed(data,['connectionId','serviceId']);const {broker}=await connectionBroker({connectionId:data.connectionId});const {connectionId,...body}=data;return api('POST','/connections/'+connectionId+'/service/state',body,broker);}
 async function connectionOpenService(data,bootstrap){typed(data,['connectionId','profileId','profileVersion','requestId']);const {record,broker}=await connectionBroker({connectionId:data.connectionId});if(data.profileId!==record.profileId||data.profileVersion!==record.profileVersion)fail('terminal_saved_connection_changed');readConnectionProfile(record.profileId,record.profileVersion);const {connectionId,...body}=data;return api('POST','/connections/'+connectionId+'/service/start',{...body,bootstrap},broker);}
 const connections=Object.fromEntries(Object.entries({open:connectionOpen,list:connectionList,state:connectionState,completeLogin:connectionCompleteLogin,loginStatus:connectionLoginStatus,confirm:data=>connectionOperation(data,'confirm'),authRead:data=>connectionOperation(data,'auth/read',['cursor','maxBytes']),authInput:data=>connectionOperation(data,'auth/input',['requestId','data']),authResize:data=>connectionOperation(data,'auth/resize',['cols','rows']),openShell:connectionOpenShell,close:connectionClose,openService:connectionOpenService,serviceState:connectionServiceState,serviceRequest:data=>connectionOperation(data,'service/request',['serviceId','requestId','method','target','data','mcp','timeoutMs']),closeService:data=>connectionOperation(data,'service/stop',['serviceId']),cancelServiceStart:data=>connectionOperation(data,'service/cancel',['requestId'])}).map(([key,value])=>[key,guarded(value)]));
 const profileEnvironmentSessions=profileId=>[...known.values()].filter(value=>value.profile?.profileId===profileId&&value.alive!==false).sort((a,b)=>a.id.localeCompare(b.id));
 const profileEnvironmentFacts=entry=>({id:entry.id,desktopSessionId:entry.desktopSessionId,kind:entry.kind,mode:entry.mode,profile:structuredClone(entry.profile),brokerId:entry.brokerId,owner:entry.owner,ownerEpoch:entry.ownerEpoch,alive:entry.alive,expired:entry.expired,expiresAt:entry.expiresAt,routeKey:entry.routeKey,baseRouteKey:entry.baseRouteKey,ownershipIntent:ownershipIntents.get(entry.id)});
 function assertProfileEnvironmentIdle(entry){
  if(entry.desktopSessionId!==desktopSessionId||entry.kind!=='ssh'||entry.alive!==true||entry.expired||Number.isFinite(entry.expiresAt)&&entry.expiresAt<=Date.now()||entry.serviceActive===true||!['idle','disconnected','failed'].includes(entry.serviceStatus||'idle')||serviceReservations.has(entry.id)||services.has(entry.id)||[...serviceAttempts.values()].some(value=>value.sessionId===entry.id&&value.dispatched&&!value.released))fail('terminal_service_active');
 }
 function environmentUpdate(receipt,saved){
  const update=profileEnvironmentUpdates.get(receipt);if(!update)fail('terminal_invalid_request');check(update.context);
  const expected=saved===undefined?update.previous:update.next,actual=profiles?.read({id:expected.id,version:expected.version});if(!equal(actual,expected)||saved!==undefined&&!equal(saved,update.next))fail('terminal_saved_connection_changed');
  if([...pendingProfiles.values()].includes(expected.id))fail('terminal_service_active');
  if(!equal([...connectionKnown.values()].filter(c=>c.profileId===expected.id&&!['closed','unsupported','requires_review'].includes(c.status)),update.connectionRows))fail('terminal_service_changed');const entries=profileEnvironmentSessions(expected.id);if(!equal(entries.map(value=>value.id),update.sessions.map(value=>value.facts.id)))fail('terminal_service_changed');
  for(let index=0;index<entries.length;index++){
   const entry=entries[index],captured=update.sessions[index];assertProfileEnvironmentIdle(entry);
   if(!equal(profileEnvironmentFacts(entry),captured.facts)||available.get(entry.brokerId)!==captured.broker||captured.broker.desktopSessionId!==desktopSessionId)fail('terminal_service_changed');
   const planHash=entry.connectionId?connectionProfileHash(expected):digest(buildTerminalLaunch(expected,entry.mode,{...settings(),platform,distribution:expected.distribution,systemRoot:env.SystemRoot||env.WINDIR}));if(planHash!==captured.facts.profile.planHash)fail('terminal_saved_connection_changed');
  }
  return update;
 }
 async function prepareProfileEnvironmentUpdate(data){
  typed(data,['previous','next']);const previous=structuredClone(data.previous),next=structuredClone(data.next);
  if(!object(previous)||!object(next)||previous.kind!=='ssh'||next.kind!=='ssh'||!identifier(previous.id)||previous.id!==next.id||!Number.isSafeInteger(previous.version)||previous.version<1||![previous.version,previous.version+1].includes(next.version))fail('terminal_invalid_request');
  const body=value=>{const {id,version,serviceEnvironment,...rest}=value;return rest;};if(!equal(body(previous),body(next))||equal(previous.serviceEnvironment,next.serviceEnvironment)!==(previous.version===next.version))fail('terminal_invalid_request');
  if(!equal(profiles?.read({id:previous.id,version:previous.version}),previous))fail('terminal_saved_connection_changed');
  if([...pendingProfiles.values()].includes(previous.id))fail('terminal_service_active');
  for(const entry of profileEnvironmentSessions(previous.id))assertProfileEnvironmentIdle(entry);await connectionList({});const connectionRows=[...connectionKnown.values()].filter(c=>c.profileId===previous.id&&!['closed','unsupported','requires_review'].includes(c.status));const context=snapshot(true),sessions=profileEnvironmentSessions(previous.id).map(entry=>{
   assertProfileEnvironmentIdle(entry);const proof=entry.connectionId?{profileId:previous.id,version:previous.version,connectionId:entry.connectionId,planHash:connectionProfileHash(previous)}:registryLaunch(previous.id,previous.version,entry.mode).proof,broker=available.get(entry.brokerId);
   if(!equal(entry.profile,proof)||!broker||broker.desktopSessionId!==desktopSessionId)fail('terminal_saved_connection_changed');
   const planHash=entry.connectionId?connectionProfileHash(next):digest(buildTerminalLaunch(next,entry.mode,{...settings(),platform,distribution:next.distribution,systemRoot:env.SystemRoot||env.WINDIR}));if(planHash!==proof.planHash)fail('terminal_saved_connection_changed');
   return {facts:profileEnvironmentFacts(entry),broker};
  });
  const receipt=Object.freeze({profileId:previous.id,previousVersion:previous.version,nextVersion:next.version,sessionIds:Object.freeze(sessions.map(value=>value.facts.id)),connectionIds:Object.freeze(connectionRows.map(c=>c.connectionId))});
  profileEnvironmentUpdates.set(receipt,{previous,next,context,sessions,connectionRows:structuredClone(connectionRows),connectionLocks:[]});
  try{
   const update=profileEnvironmentUpdates.get(receipt);for(const brokerId of new Set(connectionRows.map(c=>c.brokerId))){const broker=available.get(brokerId);if(!broker)fail('terminal_unavailable');const token=uuid();update.connectionLocks.push({broker,token});const lock=await api('POST','/connections/profile/prepare',{token,profileId:previous.id,previousVersion:previous.version,next},broker);if(lock?.token!==token||!Array.isArray(lock.connectionIds)||!equal([...lock.connectionIds].sort(),connectionRows.filter(c=>c.brokerId===brokerId).map(c=>c.connectionId).sort()))fail('terminal_service_changed');environmentUpdate(receipt);}
   for(const captured of sessions){
    const state=await api('GET','/sessions/'+captured.facts.id+'/service/state',undefined,captured.broker);environmentUpdate(receipt);
    const view=serviceView(state,captured.facts.profile);
    if(state.id!==captured.facts.id||state.ownerEpoch!==captured.facts.ownerEpoch||state.owner!==captured.facts.owner||state.alive!==true||state.expired===true||view.serviceActive||view.terminalAccess!=='available'||!['idle','disconnected','failed'].includes(view.status))fail('terminal_service_active');
   }
   environmentUpdate(receipt);return receipt;
  }catch(error){await abortProfileEnvironmentUpdate(receipt);throw error;}
 }
 async function abortProfileEnvironmentUpdate(receipt){const update=profileEnvironmentUpdates.get(receipt);if(!update)return {aborted:true};profileEnvironmentUpdates.delete(receipt);await Promise.allSettled(update.connectionLocks.map(({broker,token})=>api('POST','/connections/profile/abort',{token},broker)));return {aborted:true};}
 function assertProfileEnvironmentUpdate(receipt){environmentUpdate(receipt);return true;}
 async function commitProfileEnvironmentUpdate(receipt,saved){
  const update=environmentUpdate(receipt,saved);try{for(const {broker,token}of update.connectionLocks)await api('POST','/connections/profile/commit',{token,profile:saved},broker);environmentUpdate(receipt,saved);}catch(error){for(const entry of known.values())if(entry.profile?.profileId===saved.id)grants.delete(entry.id);await abortProfileEnvironmentUpdate(receipt);throw error;}const updates=update.sessions.map(({facts})=>{
   const current=known.get(facts.id),profile={...facts.profile,version:saved.version},baseRouteKey=digest(['desktop-terminal-v2',desktopSessionId,['desktop-profile',saved.id,saved.version,current.mode]]);
   return {...current,profile,baseRouteKey,routeKey:current.routeKey===current.baseRouteKey?baseRouteKey:current.routeKey};
  });
  const persist=()=>{for(const value of updates)catalog?.put?.('shared-terminal',value.id,value);};if(typeof catalog?.transaction==='function')catalog.transaction(persist);else persist();
  for(const value of updates){beginOwnership(value.id);grants.delete(value.id);known.set(value.id,value);}for(const row of update.connectionRows){const current=connectionKnown.get(row.connectionId);connectionKnown.set(row.connectionId,{...current,profileVersion:saved.version,revision:current.revision+1});}profileEnvironmentUpdates.delete(receipt);
  return {sessionIds:updates.map(value=>value.id),connectionIds:update.connectionRows.map(c=>c.connectionId)};
 }
 function serviceView(s,proof){
  if(!stateValid(s)||s.kind!=='ssh'||!['idle','connecting','connected','disconnected','failed'].includes(s.serviceStatus)||typeof s.serviceActive!=='boolean'||s.serviceId!==undefined&&!identifier(s.serviceId)||s.startRequestId!==undefined&&(!identifier(s.startRequestId)||s.startRequestId.length>100))fail('terminal_service_failed');
  const health=s.service;if(health!==undefined&&(!object(health)||health.name!=='gpu-sampling-studio'||health.execution_policy!=='desktop-review-v1'||!text(health.root,4096)||!health.root.startsWith('/')||!text(health.runtime,4096)||!health.runtime.startsWith('/')||!/^[a-f0-9]{20}$/.test(health.runtime_id||'')||!text(health.hostname,255)||!Number.isSafeInteger(health.uid)||health.uid<0||!text(health.machineId,128)||!Number.isInteger(health.port)||health.port<1024||health.port>65535||!text(health.transport_kind,80)))fail('terminal_service_failed');
  if(health?.bridge_capabilities!==undefined&&(!Array.isArray(health.bridge_capabilities)||health.bridge_capabilities.length>1||health.bridge_capabilities.some(value=>value!=='scheduler-inspection-v1')))fail('terminal_service_failed');
  if(s.servicePhase!==undefined&&!servicePhases.has(s.servicePhase)||s.terminalAccess!==undefined&&!['available','reserved','unknown'].includes(s.terminalAccess))fail('terminal_service_failed');
  if(s.progress!==undefined&&(!object(s.progress)||Object.keys(s.progress).some(key=>!['kind','completedBytes','totalBytes'].includes(key))||s.progress.kind!=='transfer'||!Number.isSafeInteger(s.progress.completedBytes)||!Number.isSafeInteger(s.progress.totalBytes)||s.progress.completedBytes<0||s.progress.completedBytes>s.progress.totalBytes||s.progress.totalBytes>16*1024*1024))fail('terminal_service_failed');
  let error;if(s.error){const e=s.error;if(!object(e)||Object.keys(e).some(key=>!['code','phase','errno','python','sqlite'].includes(key))||e.phase!==undefined&&!servicePhases.has(e.phase)&&e.phase!=='request'||e.errno!==undefined&&(!Number.isInteger(e.errno)||e.errno<0||e.errno>65535)||['python','sqlite'].some(key=>e[key]!==undefined&&(!Array.isArray(e[key])||e[key].length!==3||e[key].some(n=>!Number.isInteger(n)||n<0||n>65535))))fail('terminal_service_failed');error={code:remoteServiceErrors.has(e.code)?e.code:brokerRefusals.get(e.code)||'terminal_service_failed',...e.phase?{phase:e.phase}:{},...e.errno!==undefined?{errno:e.errno}:{},...e.python?{python:[...e.python]}:{},...e.sqlite?{sqlite:[...e.sqlite]}:{}};}
  return {status:s.serviceStatus,sessionId:s.id,profileId:proof.profileId,profileVersion:proof.version,ownerEpoch:s.ownerEpoch,serviceActive:s.serviceActive,terminalAccess:s.terminalAccess||(s.serviceActive?(s.serviceStatus==='failed'?'unknown':'reserved'):'available'),...s.startRequestId?{attemptId:s.startRequestId}:{},...s.servicePhase?{phase:s.servicePhase}:{},...s.progress?{progress:structuredClone(s.progress)}:{},...s.serviceId?{serviceId:s.serviceId}:{},...health?{service:{...Object.fromEntries(['name','execution_policy','root','runtime','runtime_id','hostname','uid','machineId','port','transport_kind'].map(key=>[key,health[key]])),...health.bridge_capabilities?{bridge_capabilities:[...health.bridge_capabilities]}:{}}}:{},...error?{error}:{}};
 }
 async function serviceState(data){
  typed(data,['sessionId']);const c=snapshot(true),proof=serviceProfile(data.sessionId);if(!await ensure())fail('terminal_service_unavailable');check(c);
  const s=await api('GET','/sessions/'+data.sessionId+'/service/state');check(c);checkProfile(proof,s.mode);remember(s,brokerFor('/sessions/'+s.id+'/service/state'));const view=serviceView(s,proof),attempt=serviceAttempts.get(data.sessionId+':'+view.attemptId);if(attempt?.dispatched&&view.sessionId===data.sessionId&&equal(attempt.proof,proof)&&attempt.brokerId===known.get(data.sessionId)?.brokerId){if(view.serviceId)attempt.serviceId=view.serviceId;if(!view.serviceActive&&view.terminalAccess==='available')attempt.released=true;}return view;
 }
 async function connectService(data,bootstrap){
  let record;
  try{
  typed(data,['sessionId','ownerEpoch','profileId','profileVersion','requestId']);epoch(data.ownerEpoch);if(!identifier(data.requestId)||data.requestId.length>100||!object(bootstrap)||Object.keys(bootstrap).some(key=>!['source','payload','transport','serviceEnvironment','reuseOnly'].includes(key))||typeof bootstrap.source!=='string'||!object(bootstrap.payload)||bootstrap.reuseOnly!==undefined&&typeof bootstrap.reuseOnly!=='boolean'||bootstrap.transport!==undefined&&(!object(bootstrap.transport)||Object.keys(bootstrap.transport).some(key=>!['source','sha256'].includes(key))||typeof bootstrap.transport.source!=='string'||!/^[a-f0-9]{64}$/.test(bootstrap.transport.sha256||'')||createHash('sha256').update(bootstrap.transport.source).digest('hex')!==bootstrap.transport.sha256))fail('terminal_invalid_request');
  if(bootstrap.serviceEnvironment!==undefined){const value=bootstrap.serviceEnvironment;if(!object(value)||Object.keys(value).some(key=>!['python','activation'].includes(key))||value.python!==undefined&&(typeof value.python!=='string'||!value.python||Buffer.byteLength(value.python)>4096||/[\r\n\0\\]/.test(value.python)||!(/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(value.python)||value.python.startsWith('/')&&value.python!=='/'))||value.activation!==undefined&&(typeof value.activation!=='string'||Buffer.byteLength(value.activation)>8192||value.activation.includes('\0')))fail('terminal_invalid_request');}
  const signature=digest({bootstrap,ownerEpoch:data.ownerEpoch}),attemptKey=data.sessionId+':'+data.requestId;let attempt=serviceAttempts.get(attemptKey);if(attempt&&attempt.signature!==signature)fail('terminal_invalid_request');if(attempt?.cancelled)fail('terminal_service_changed');const previous=serviceReservations.get(data.sessionId);if(previous){if(previous.requestId!==data.requestId)fail('terminal_service_active');if(previous.signature!==signature)fail('terminal_invalid_request');return previous.promise;}
  const proof=serviceProfile(data.sessionId);if(data.profileId!==proof.profileId||data.profileVersion!==proof.version)fail('terminal_saved_connection_changed');
  const replay=!!attempt;if(!attempt){if(serviceAttempts.size>=64)fail('terminal_service_unavailable');attempt={signature,sessionId:data.sessionId,desktopSessionId,proof:structuredClone(proof),brokerId:known.get(data.sessionId)?.brokerId,dispatched:false};serviceAttempts.set(attemptKey,attempt);}
  const c=snapshot(true),assertOwnership=beginOwnership(data.sessionId);record={requestId:data.requestId,signature,attempt};grants.delete(data.sessionId);serviceReservations.set(data.sessionId,record);
  record.promise=(async()=>{
   const s=await state(data.sessionId);check(c);assertOwnership();checkProfile(proof,s.mode);if(s.owner!=='human')fail('terminal_human_owned');if(!replay&&s.ownerEpoch!==data.ownerEpoch)fail('terminal_owner_changed');if(attempt.cancelled)fail('terminal_service_changed');
   // Set before invoking the transport: synchronous rejection or a lost reply
   // cannot prove that this attempt never reached the broker.
   attempt.dispatched=true;record.dispatched=true;
   const result=await api('POST','/sessions/'+s.id+'/service/start',{ownerEpoch:data.ownerEpoch,requestId:data.requestId,bootstrap});check(c);assertOwnership();checkProfile(proof,result.mode);remember(result,brokerFor('/sessions/'+result.id+'/service/start'));
   const view=serviceView(result,proof);if(view.serviceId)attempt.serviceId=view.serviceId;if(!view.serviceActive&&view.terminalAccess==='available')attempt.released=true;if(view.status!=='connected'||!view.serviceActive||!view.serviceId||!view.service){if(bootstrap.transport&&view.status==='failed'&&view.serviceId){services.delete(s.id);return view;}fail('terminal_service_unknown');}
   services.set(s.id,{proof:structuredClone(proof),serviceId:view.serviceId,ownerEpoch:view.ownerEpoch,target:attempt});return view;
  })();
  return await record.promise;
  }catch(error){
   if(bootstrap?.transport&&serviceWasNotStarted(data,record)){const safeError=Error(safe(error));serviceNotStartedErrors.add(safeError);throw safeError;}throw error;
  }finally{if(record&&serviceReservations.get(data.sessionId)===record)serviceReservations.delete(data.sessionId);}
 }
 function cancelServiceStart(data){
  typed(data,['sessionId','requestId']);if(!identifier(data.sessionId)||!identifier(data.requestId)||data.requestId.length>100)fail('terminal_invalid_request');const key=data.sessionId+':'+data.requestId,reservation=serviceReservations.get(data.sessionId);if(reservation&&reservation.requestId!==data.requestId)fail('terminal_service_changed');
  const attempt=serviceAttempts.get(key);if(!attempt)fail('terminal_service_changed');if(attempt.cancelPromise)return attempt.cancelPromise;
  const {proof,broker}=serviceCleanupTarget(data.sessionId,attempt);
  // Fence the pre-dispatch await synchronously. The broker tombstone separately
  // orders cancellation against an already sent but not yet consumed HTTP body.
  attempt.cancelled=true;const assertOwnership=beginOwnership(data.sessionId);grants.delete(data.sessionId);
  attempt.cancelPromise=(async()=>{const result=await api('POST','/sessions/'+data.sessionId+'/service/cancel',{requestId:data.requestId},broker);serviceCleanupTarget(data.sessionId,attempt);assertOwnership();if(result.id!==data.sessionId||result.cancelled!==true||result.cancelledRequestId!==data.requestId)fail('terminal_service_unknown');remember(result,broker);const view=serviceView(result,proof);if(!view.serviceActive&&view.terminalAccess==='available')attempt.released=true;if(view.attemptId===data.requestId&&!view.serviceActive&&services.get(data.sessionId)?.serviceId===view.serviceId)services.delete(data.sessionId);return {...view,cancelled:true,cancelledAttemptId:data.requestId};})();return attempt.cancelPromise;
 }
 async function serviceRequest(data){
  typed(data,['sessionId','serviceId','requestId','method','target','data','mcp','timeoutMs']);if(!identifier(data.serviceId)||!identifier(data.requestId)||data.requestId.length>100||!['GET','POST'].includes(data.method)||typeof data.target!=='string'||data.mcp!==undefined&&typeof data.mcp!=='boolean'||data.timeoutMs!==undefined&&(!Number.isInteger(data.timeoutMs)||data.timeoutMs<250||data.timeoutMs>245000))fail('terminal_invalid_request');
  const c=snapshot(true),proof=serviceProfile(data.sessionId),record=services.get(data.sessionId);if(!record||record.serviceId!==data.serviceId||!equal(record.proof,proof))fail('terminal_service_changed');
  const result=await api('POST','/sessions/'+data.sessionId+'/service/request',{serviceId:data.serviceId,requestId:data.requestId,method:data.method,target:data.target,...Object.hasOwn(data,'data')?{data:data.data}:{},mcp:data.mcp===true,...data.timeoutMs!==undefined?{timeoutMs:data.timeoutMs}:{}});
  check(c);checkProfile(proof,known.get(data.sessionId)?.mode);if(services.get(data.sessionId)!==record)fail('terminal_service_changed');if(!object(result)||!Number.isInteger(result.status)||result.status<100||result.status>599||!Object.hasOwn(result,'data'))fail('terminal_service_failed');return result;
 }
 async function disconnectService(data){
  typed(data,['sessionId','serviceId']);if(!identifier(data.sessionId)||!identifier(data.serviceId))fail('terminal_invalid_request');const service=services.get(data.sessionId),target=service?.serviceId===data.serviceId?service.target:[...serviceAttempts.values()].find(value=>value.sessionId===data.sessionId&&value.dispatched&&value.serviceId===data.serviceId);if(!target)fail('terminal_service_changed');const {proof,broker}=serviceCleanupTarget(data.sessionId,target);grants.delete(data.sessionId);const assertOwnership=beginOwnership(data.sessionId);
  const result=await api('POST','/sessions/'+data.sessionId+'/service/stop',{serviceId:data.serviceId},broker);serviceCleanupTarget(data.sessionId,target);assertOwnership();if(result.id!==data.sessionId)fail('terminal_service_unknown');remember(result,broker);const view=serviceView(result,proof);if(!view.serviceActive&&view.terminalAccess==='available'){target.released=true;if(service?.serviceId===data.serviceId&&services.get(data.sessionId)===service)services.delete(data.sessionId);}return view;
 }
 // Main-only resource facts. Never creates a terminal, reads its output, changes
 // ownership or treats an alive SSH process as authentication/worker evidence.
 async function resourceState(data){
  typed(data,['sessionId']);if(!identifier(data.sessionId))fail('terminal_invalid_request');
  const c=snapshot(true),entry=known.get(data.sessionId),profile=entry?.profile;
  if(entry?.kind!=='ssh'||!profile)fail('terminal_saved_connection_changed');
  checkProfile(profile,entry.mode);const s=await state(data.sessionId);check(c);
  if(s.id!==data.sessionId||s.kind!=='ssh')fail('terminal_unavailable');checkProfile(profile,s.mode);
  const grant=grants.get(s.id),selected=ownerScope(current()),agentReady=!!(s.alive&&!s.expired&&(!Number.isFinite(s.expiresAt)||s.expiresAt>Date.now())&&s.owner==='agent'&&selected&&grant&&equal(grant.scope,selected)&&grant.ownerEpoch===s.ownerEpoch&&grant.selectionRevision===selectionRevision()&&equal(grant.profile,profile)&&resourceAllowed(s.id,profile));
  const parent=entry.connectionId?connectionKnown.get(entry.connectionId):null;return {resource:entry.connectionId?{kind:'ssh-connection',connectionId:entry.connectionId,profileId:profile.profileId,profileVersion:profile.version}:{kind:'ssh-terminal',profileId:profile.profileId,profileVersion:profile.version},...entry.connectionId?{connectionId:entry.connectionId,terminalSessionId:s.id,parentAuthentication:parent?.authentication}:{},sessionId:s.id,operator:s.owner,ownerEpoch:s.ownerEpoch,processStatus:s.expired?'expired':s.alive?'running':'exited',alive:s.alive,agentReady:agentReady&&!s.serviceActive,serviceActive:s.serviceActive===true,serviceStatus:s.serviceStatus||'idle',authentication:parent?.authentication==='verified'?'verified':'not_observed',managedRuns:false};
 }
 function agent(scope,id){const selected=ownerScope(current()),grant=grants.get(id);if(grant&&!currentGrant(grant)){grants.delete(id);fail('terminal_scope_denied');}if(!scope||scope.checkCurrent?.()!==true||!selected||!equal(ownerScope(scope),selected)||!grant||!equal(grant.scope,selected)||grant.selectionRevision!==selectionRevision()||!resourceAllowed(id,grant.profile))fail('terminal_scope_denied');if(grant.profile)checkProfile(grant.profile,known.get(id)?.mode);else{if(grant.source&&grant.source!==sourceStamp())fail('terminal_context_changed');sourceGuard();}return grant;}
 function serviceEnvironmentGuideFor(grant,session){
  const selected=getSelectedResource(),proof=grant.profile;
  if(!proof||session?.kind!=='ssh'||session.alive!==true||session.expired===true||session.serviceActive===true||session.owner!=='agent'||session.ownerEpoch!==grant.ownerEpoch||!(['ssh-terminal','ssh-connection'].includes(selected?.kind)&&resourceAllowed(session.id,proof)))return {};
  const profile=profiles.read({id:proof.profileId,version:proof.version});
  // Historical worker-owned terminal references are not local connection skills.
  if(profile.kind!=='ssh'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(profile.id||'')||profile.id!==proof.profileId||profile.version!==proof.version)return {};
  return {serviceEnvironmentGuide:sshServiceEnvironmentGuide(profile)};
 }
 async function callTool(name,args,scope){
  if(name==='list_shared_terminals'){typed(args,[]);if(!scope||scope.checkCurrent?.()!==true||!equal(ownerScope(scope),ownerScope(current()))||!ownerScope(current()))fail('terminal_scope_denied');const result=[];for(const [id,grant]of grants){if(!currentGrant(grant)){grants.delete(id);continue;}if(!equal(grant.scope,ownerScope(current()))||grant.source&&grant.source!==sourceStamp()||grant.selectionRevision!==selectionRevision()||!resourceAllowed(id,grant.profile))continue;const c=snapshot(!!grant.profile);agent(scope,id);const s=await state(id);check(c);if(agent(scope,id)!==grant)fail('terminal_scope_denied');if(s.owner==='agent'&&s.ownerEpoch===grant.ownerEpoch)result.push({...describe(s),...serviceEnvironmentGuideFor(grant,s)});}return {sessions:result};}
  if(!['read_shared_terminal','write_shared_terminal'].includes(name))fail('terminal_unknown_operation');typed(args,name==='read_shared_terminal'?['session_id','cursor','max_bytes']:['session_id','request_id','data']);if(!identifier(args.session_id))fail('terminal_invalid_request');const id=args.session_id,grant=agent(scope,id),c=snapshot(!!grant.profile);if(!await ensure())fail('terminal_unavailable');check(c);if(agent(scope,id)!==grant)fail('terminal_scope_denied');
  if(name==='read_shared_terminal'){if(args.cursor!==undefined&&(!Number.isSafeInteger(args.cursor)||args.cursor<0))fail(readErrors.cursor);if(args.max_bytes!==undefined&&(!Number.isSafeInteger(args.max_bytes)||args.max_bytes<1||args.max_bytes>65536))fail(readErrors.maxBytes);const effective=Math.max(16384,args.max_bytes??65536);const r=await api('POST','/sessions/'+id+'/read',{actor:'agent',scope:grant.scope,ownerEpoch:grant.ownerEpoch,...args.cursor!==undefined?{cursor:args.cursor}:{},maxBytes:effective});check(c);if(agent(scope,id)!==grant)fail('terminal_scope_denied');return {...readResult(r,id),...serviceEnvironmentGuideFor(grant,r.state),...args.max_bytes!==undefined?{requested_max_bytes:args.max_bytes}:{},effective_max_bytes:effective};}
  const v={requestId:args.request_id,data:args.data};inputValid(v);await api('POST','/sessions/'+id+'/input',{actor:'agent',scope:grant.scope,ownerEpoch:grant.ownerEpoch,...v});check(c);if(agent(scope,id)!==grant)fail('terminal_scope_denied');return {accepted:true,sessionId:id};
 }
 // Cached readiness hint only: callTool remains the live lease/profile/source authority.
 function hasCurrentGrant(provider,sessionId){try{if(closing)return false;const selected=ownerScope(current());if(!selected||selected.provider!==provider)return false;for(const [id,grant]of grants){if(!currentGrant(grant)){grants.delete(id);continue;}if(sessionId!==undefined&&sessionId!==id||grant.selectionRevision!==selectionRevision()||!resourceAllowed(id,grant.profile))continue;const s=known.get(id);if(equal(grant.scope,selected)&&s?.owner==='agent'&&s.ownerEpoch===grant.ownerEpoch&&s.alive===true&&!s.expired&&(!Number.isFinite(s.expiresAt)||s.expiresAt>Date.now())&&(!grant.source||grant.source===sourceStamp()))return true;}return false;}catch{return false;}}
 function inUseProfileIds(){return [...new Set([...pendingProfiles.values(),...[...connectionKnown.values()].filter(c=>!['closed','unsupported','requires_review'].includes(c.status)).map(c=>c.profileId),...[...known.values()].filter(s=>s.alive!==false&&s.profile).map(s=>s.profile.profileId)])];}
 function shutdown({timeoutMs=4000}={}){
  if(shutdownPromise)return shutdownPromise;
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>15000)return Promise.reject(Error('terminal_invalid_request'));
  // The quit boundary precedes every await: no late prepare/open/owner result
  // may spawn a child, publish a session or restore an Agent grant after this.
  closing=true;grants.clear();ownershipIntents.clear();ownershipSerial++;
  let loadFailed=false;try{load(true);}catch{loadFailed=true;}
  const descriptors=[...registered.values()].filter(d=>d.desktopSessionId===desktopSessionId),pending=[booting,restoring,...opening.values()].filter(Boolean),deadline=Date.now()+timeoutMs;
  const bounded=async(promise,limit)=>{let timer;try{return await Promise.race([Promise.resolve(promise).then(value=>({done:true,value}),()=>({done:true,value:false})),new Promise(resolve=>{timer=setTimeout(()=>resolve({done:false}),Math.max(0,limit));})]);}finally{clearTimeout(timer);}};
  const stop=async d=>{
   try{
    const health=await requestApi(d,'GET','/health');if(health?.instanceId!==d.instanceId||health.pid!==d.pid)return false;
    const response=await requestApi(d,'POST','/shutdown',{});if(response?.stopped!==true)return false;
    const owned=children.get(d.instanceId);
    if(owned){await owned.exit;return true;}
    // A same-desktop bridge reconstruction has no ChildProcess handle. A
    // stopped authenticated listener confirms closure without PID signalling.
    while(Date.now()<deadline){try{await requestApi(d,'GET','/health');}catch{return true;}await new Promise(resolve=>setTimeout(resolve,25));}
   }catch{}
   return false;
  };
  shutdownPromise=(async()=>{
   const stops=descriptors.map(stop),work=Promise.all([Promise.all(stops),Promise.allSettled(pending)]);
   const observed=await bounded(work,Math.max(0,timeoutMs-200));
   let unconfirmed=loadFailed?1:0;
   if(!observed.done)unconfirmed+=Math.max(1,descriptors.length);
   else unconfirmed+=observed.value?.[0]?.filter(value=>!value).length||0;
   // Only handles created by this controller are eligible for bounded fallback.
   // Historical descriptors and all worker/scheduler jobs are never signalled.
   for(const tracked of children.values())if(!tracked.exited){try{tracked.child.kill?.();}catch{}tracked.child.stdin?.destroy?.();tracked.child.stdout?.destroy?.();}
   await bounded(Promise.all([...children.values()].map(value=>value.exit)),Math.max(0,deadline-Date.now()));
   if([...children.values()].some(value=>!value.exited))unconfirmed++;
   const status=unconfirmed?'unconfirmed':'closed';
   for(const value of known.values())archive('shared-terminal',value,'desktop-exit',{shutdownStatus:status});
   for(const value of catalog?.list?.('shared-terminal-pending')||[])if(value.desktopSessionId===desktopSessionId)archive('shared-terminal-pending',value,'desktop-exit',{shutdownStatus:status});
   if(loaded&&fs.existsSync(registryFile))try{writeEncrypted(registryFile,{schema_version:2,desktop_session_id:desktopSessionId,active_instance_id:activeId,brokers:descriptors,closed:true,shutdown_status:status});}catch{unconfirmed++;}
   known.clear();connectionKnown.clear();uncertain.clear();pendingProfiles.clear();available.clear();services.clear();serviceReservations.clear();serviceAttempts.clear();daemon=null;
   return {status:unconfirmed?'unconfirmed':'closed',brokers:descriptors.length,unconfirmed};
  })();
  return shutdownPromise;
 }
 return {connections,reconcileContext:()=>{const selected=ownerScope(current());for(const [id,grant]of grants)if(!selected||!currentGrant(grant)||!equal(grant.scope,selected)||grant.selectionRevision!==selectionRevision())grants.delete(id);},...Object.fromEntries(Object.entries({list,open,read,input,resize,owner,close,resourceState,connectService,cancelServiceStart,serviceRequest,disconnectService,serviceState,prepareProfileEnvironmentUpdate,callTool}).map(([k,v])=>[k,guarded(v)])),assertProfileEnvironmentUpdate:guardedSync(assertProfileEnvironmentUpdate),commitProfileEnvironmentUpdate:guarded(commitProfileEnvironmentUpdate),abortProfileEnvironmentUpdate:guarded(abortProfileEnvironmentUpdate),tools:()=>sharedTerminalTools,hasCurrentGrant,inUseProfileIds,ownsSession:id=>!closing&&known.has(id),shutdown,detach:()=>{}};
}
