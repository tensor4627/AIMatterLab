/** Human-authenticated OpenSSH master and independent, fail-closed slave channels. */
import path from 'node:path';
import {sharedShellService} from './shared-shell-service.mjs';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {createTerminalSession,TerminalFault,exact} from './session.mjs';

const fail=(code,status=409)=>{throw new TerminalFault(code,status);};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const text=(value,max=4096)=>typeof value==='string'&&value.length<=max&&!/[\0\r\n]/.test(value);
const loginName=/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99})?$/;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const helperPath=fileURLToPath(new URL('./ssh-multiplex-helper.py',import.meta.url));
const DEFAULT_ENV=()=>Object.fromEntries(['SystemRoot','WINDIR','ComSpec','ProgramData','PATH','PATHEXT','TEMP','TMP','USERPROFILE','HOME','USER','LOGNAME','LANG','LC_ALL','SSH_AUTH_SOCK'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));
function windowsToLinux(value){if(!/^[A-Za-z]:[\\/]/.test(value))fail('ssh_linux_client_namespace_required');return '/mnt/'+value[0].toLowerCase()+'/'+value.slice(3).replaceAll('\\','/');}

/** Transport fields only. Environment activation never enters the master argv. */
export function multiplexProfile(profile){
 if(!profile||profile.kind!=='ssh'||profile.import_review?.requires_review||profile.via?.length)fail('ssh_route_requires_review');
 if(profile.mode!==undefined&&!['interactive','key'].includes(profile.mode))fail('ssh_route_requires_review');
 const result={mode:profile.mode||'interactive',host:profile.host,username:profile.username,port:profile.port,ssh_client:profile.ssh_client,identity_file:profile.identity_file||'',proxy_jump:profile.proxy_jump||[]};
 if(!/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}$/.test(result.host||'')||!loginName.test(result.username||'')||!Number.isInteger(result.port)||result.port<1||result.port>65535||!text(result.ssh_client)||!result.ssh_client||!text(result.identity_file)||!Array.isArray(result.proxy_jump)||result.proxy_jump.length>8||result.proxy_jump.some(v=>typeof v!=='string'||! /^[A-Za-z_][A-Za-z0-9_.-]{0,63}@(?:\[[0-9A-Fa-f:]+\]|[A-Za-z0-9][A-Za-z0-9.-]{0,255}):[0-9]{1,5}$/.test(v)||Number(v.slice(v.lastIndexOf(':')+1))<1||Number(v.slice(v.lastIndexOf(':')+1))>65535))fail('ssh_route_requires_review');
 return result;
}
export function multiplexArgs(profile,socket,{master=false,control,tty=false,command}={}){
 let args;if(master){args=['-F','/dev/null','-M','-N','-S',socket,'-o','ControlMaster=yes','-o','ControlPersist=no','-o','ForkAfterAuthentication=no','-o','SessionType=none','-o','RemoteCommand=none','-o',profile.mode==='key'?'StrictHostKeyChecking=yes':'StrictHostKeyChecking=ask','-o',profile.mode==='key'?'BatchMode=yes':'BatchMode=no','-o','ConnectionAttempts=1','-o','ConnectTimeout=15','-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','PermitLocalCommand=no','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2'];if(profile.proxy_jump.length)args.push('-J',profile.proxy_jump.join(','));if(profile.identity_file)args.push('-i',profile.identity_file);if(profile.known_hosts_file)args.push('-o','UserKnownHostsFile='+profile.known_hosts_file,'-o','GlobalKnownHostsFile=/dev/null');}
 else{args=['-o','ProxyCommand=/bin/false','-F','/dev/null','-o','ControlMaster=no','-o','ControlPersist=no','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','PermitLocalCommand=no','-S',socket];args.push(...control?['-O',control]:[tty?'-tt':'-T']);}
 args.push('-l',profile.username,'-p',String(profile.port),profile.host);if(command!==undefined)args.push(command);return [profile.ssh_client,...args];
}
function execute(file,args,{timeout=10000,limit=262144}={}){return new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,encoding:'utf8',timeout,maxBuffer:limit,env:DEFAULT_ENV()},(error,stdout,stderr)=>{if(error&&!Number.isInteger(error.code))return reject(new TerminalFault('ssh_control_unavailable'));resolve({code:error?.code??0,stdout,stderr});}));}
// The wrapper reports the Linux process identity before exec; the control socket
// must later prove this exact process, client executable, argv and start time.
const MASTER_WRAPPER='import os,sys,json,base64; a=json.loads(sys.argv[2]); p=os.getpid(); s=open("/proc/self/stat").read().rsplit(")",1)[1].split()[19]; b=open("/proc/sys/kernel/random/boot_id").read().strip(); v={"pid":p,"start":s,"boot":b}; print("__STUDIO_MASTER_"+sys.argv[1]+"__:"+base64.b64encode(json.dumps(v,separators=(",",":")).encode()).decode()+"__STUDIO_MASTER_END_"+sys.argv[1]+"__",flush=True); os.execv(a[0],a)';
const startupText=value=>value.replace(/\x1b\](?:0|2);[^\x00-\x1f\x7f]{0,512}(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');

/** Local helper output contains proof only; never authentication bytes. */
export function createMultiplexHost({platform=process.platform,cwd=process.cwd(),env=process.env,run=execute,knownHostsFile}={}){
 const localProfile=profile=>({...multiplexProfile(profile),...knownHostsFile?{known_hosts_file:knownHostsFile}:{}});
 function transport(profile){
  const linux=profile.ssh_client.startsWith('/')&&!profile.ssh_client.startsWith('/mnt/')&&!profile.ssh_client.toLowerCase().endsWith('.exe');
  if(platform==='win32'&&!linux)return {native:true,file:/^\/mnt\/[a-z]\//i.test(profile.ssh_client)?profile.ssh_client[5].toUpperCase()+':\\'+profile.ssh_client.slice(7).replaceAll('/','\\'):profile.ssh_client};
  if(!linux||profile.identity_file&&(!profile.identity_file.startsWith('/')||profile.identity_file.startsWith('/mnt/')))fail('ssh_linux_client_namespace_required');
  if(platform==='win32'){
   if(!text(profile.distribution,200)||!profile.distribution)fail('ssh_linux_client_namespace_required');
   return {file:path.win32.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','wsl.exe'),prefix:['--distribution',profile.distribution,'--exec'],helper:windowsToLinux(helperPath)};
  }
  return {file:'/usr/bin/python3',prefix:[],helper:helperPath};
 }
 function python(profile,args){const t=transport(profile);if(t.native)fail('ssh_multiplex_unsupported');return t.prefix.length?{file:t.file,args:[...t.prefix,'/usr/bin/python3',...args],cwd,env:DEFAULT_ENV()}:{file:t.file,args,cwd,env:DEFAULT_ENV()};}
 async function helper(operation,profile,value={}){
  const launch=python(profile,['-I',transport(profile).helper,operation,JSON.stringify({profile:localProfile(profile),...value})]);
  const result=await run(launch.file,launch.args,{timeout:operation==='prove'?15000:10000});let decoded;try{decoded=JSON.parse(result.stdout);}catch{fail('ssh_control_unavailable');}
  if(!decoded?.ok||result.code!==0)fail(/^ssh_[a-z_]+$/.test(decoded?.code||'')?decoded.code:'ssh_control_unavailable');return decoded.value;
 }
 return {
  async allocate(profile){const t=transport(profile);if(t.native){
   // A real local-only control request distinguishes this platform limitation.
   // The first false proxy and BatchMode forbid a network/login fallback.
   await run(t.file,['-o','ProxyCommand=cmd /c exit 1','-F','NUL','-o','BatchMode=yes','-S',path.win32.join(env.TEMP||'C:\\Windows\\Temp','studio-absent-'+randomUUID()),'-O','check','127.0.0.1'],{timeout:5000,limit:8192}).catch(()=>{});fail('ssh_multiplex_unsupported');
  }return helper('allocate',profile);},
  check:(profile,proof,master)=>helper('check',profile,{proof,master}),
  ready:(profile,proof,master)=>helper('ready',profile,{proof,master}),
  prove:(profile,proof,master)=>helper('prove',profile,{proof,master}),
  close:(profile,proof,master)=>helper('close',profile,{proof,master}),
  observeClosed:(profile,proof,master)=>helper('closed',profile,{proof,master}),
  cleanup:(profile,proof)=>helper('cleanup',profile,{proof}),
  masterLaunch:(profile,proof,nonce)=>python(profile,['-I','-u','-c',MASTER_WRAPPER,nonce,JSON.stringify(multiplexArgs(localProfile(profile),proof.socket,{master:true}))]),
  slaveLaunch(profile,proof,command){const argv=multiplexArgs(multiplexProfile(profile),proof.socket,{tty:true,command}),t=transport(profile);return t.prefix.length?{file:t.file,args:[...t.prefix,...argv],cwd,env:DEFAULT_ENV()}:{file:argv[0],args:argv.slice(1),cwd,env:DEFAULT_ENV()};}
 };
}

export function createSshConnections({pty,sessions,now=Date.now,host=createMultiplexHost(),serviceTimeouts,sessionFactory=createTerminalSession,profileUpdateLeaseMs=30000,closeWaitMs=2000}={}){
 if(!Number.isInteger(closeWaitMs)||closeWaitMs<0||closeWaitMs>2000)fail('invalid_request',400);
 if(!Number.isInteger(profileUpdateLeaseMs)||profileUpdateLeaseMs<1||profileUpdateLeaseMs>60000)fail('invalid_request',400);
 const records=new Map(),opens=new Map(),profileUpdates=new Map();let closing=false;
 function ref(value,extra=[]){exact(value,['connectionId','profileId','profileVersion',...extra],['connectionId',...extra.filter(k=>!['cursor','maxBytes'].includes(k))]);const r=records.get(value.connectionId);if(!r)fail('ssh_connection_not_found',404);if(value.profileId!==undefined&&(value.profileId!==r.profile.id||value.profileVersion!==r.profile.version)||value.profileVersion!==undefined&&value.profileId===undefined)fail('ssh_connection_changed');return r;}
 function view(r){const terminals=[...r.shells].filter(id=>sessions.get(id)?.state().alive&&!sessions.get(id)?.state().closed),service=r.service?.shared?.view()||r.service?.session?.serviceState();return {schemaVersion:2,connectionId:r.id,loginRequestId:r.loginRequestId,profileId:r.profile.id,profileVersion:r.profile.version,status:r.status,authentication:r.authentication,capabilities:{multiplex:r.status==='authenticated'},terminalSessionIds:terminals,serviceIds:service?.serviceActive&&service.serviceId?[service.serviceId]:[],revision:r.revision,...r.closeRequested?{closed:r.closeProof===true}:{},...r.error?{error:{code:r.error}}:{}};}
 function lost(r,code='ssh_master_unavailable'){if(r.status==='closed')return;if(r.profileUpdate){profileUpdates.get(r.profileUpdate)?.invalid?.();r.profileUpdate=null;}r.generation++;r.status='unavailable';r.authentication='lost';r.error=code;r.revision++;r.ring=[];r.bytes=0;for(const id of r.shells)sessions.get(id)?.dispose();r.service?.session?.dispose();}
 async function verified(r,allowLocked=false){expireProfileUpdates();if(r.profileUpdate&&!allowLocked)fail('service_active',423);if(closing||r.status!=='authenticated'||r.authentication!=='verified')fail('ssh_authentication_unconfirmed');try{await host.check(r.profile,r.proof,r.master);}catch(error){lost(r,error.code||'ssh_master_unavailable');throw error;}if(closing||r.status!=='authenticated'||r.profileUpdate&&!allowLocked)fail('ssh_connection_changed');return r;}
 function append(r,data){if(r.status!=='authenticating'||typeof data!=='string')return;for(let at=0;at<data.length;at+=8192){const part=data.slice(at,at+8192);r.ring.push({sequence:++r.sequence,data:part});r.bytes+=Buffer.byteLength(part);while(r.bytes>65536){r.bytes-=Buffer.byteLength(r.ring.shift().data);}}}
 async function open(value){exact(value,['profileId','profileVersion','requestId','profile'],['profileId','profileVersion','requestId','profile']);if(!id(value.requestId)||!id(value.profileId)||!Number.isSafeInteger(value.profileVersion)||value.profileVersion<1||value.profile?.id!==value.profileId||value.profile.version!==value.profileVersion)fail('invalid_request',400);const signature=digest(value),previous=opens.get(value.requestId);if(previous){if(previous.signature!==signature)fail('request_changed');return previous.promise;}if(closing||records.size>=64||opens.size>=128||[...records.values()].filter(r=>['authenticating','authenticated'].includes(r.status)||r.status==='unavailable'&&!!r.terminal).length>=8)fail('ssh_connection_limit');
  const r={id:randomUUID(),profile:structuredClone(value.profile),loginRequestId:value.requestId,generation:1,status:'authenticating',authentication:'pending',revision:1,ring:[],bytes:0,sequence:0,shells:new Set(),shellRequests:new Map(),inputRequests:new Map(),cancelled:new Set(),alive:true};records.set(r.id,r);
  const promise=(async()=>{try{multiplexProfile(r.profile);r.proof=await host.allocate(r.profile);if(closing||r.status!=='authenticating'){await host.cleanup(r.profile,r.proof).catch(()=>{});fail('ssh_connection_changed');}const nonce=randomBytes(24).toString('hex'),prefix='__STUDIO_MASTER_'+nonce+'__:',suffix='__STUDIO_MASTER_END_'+nonce+'__';let initial='',marker=false,markerTail='';const launch=host.masterLaunch(r.profile,r.proof,nonce);r.terminal=pty.spawn(launch.file,launch.args,{name:'xterm-256color',cols:500,rows:30,cwd:launch.cwd,env:launch.env??DEFAULT_ENV()});
    r.terminal.onData(data=>{
     if(!['authenticating','authenticated'].includes(r.status))return;
     if(marker){const compact=markerTail+startupText(data).replace(/[\r\n]/g,'');if(compact.includes(prefix))return lost(r,'ssh_master_identity_changed');markerTail=compact.slice(-prefix.length);return append(r,data);}
     initial+=data;if(initial.length>4096)return lost(r,'ssh_master_identity_changed');
     // ConPTY inserts physical CRLFs when the auth viewport resizes, even in
     // this local wrapper's marker. Bound the prelude and require both exact
     // random-nonce delimiters before decoding the complete process identity.
     const clean=startupText(initial),compact=clean.replace(/[\r\n]/g,''),start=compact.indexOf(prefix),end=start<0?-1:compact.indexOf(suffix,start+prefix.length),foreign=/__STUDIO_MASTER_([a-f0-9]{48})__:/.exec(compact);
     if(foreign&&foreign[1]!==nonce)return lost(r,'ssh_master_identity_changed');if(start<0||end<0)return;
     if(compact.indexOf('__STUDIO_MASTER_',start+prefix.length)!==end||compact.indexOf('__STUDIO_MASTER_',end+suffix.length)>=0)return lost(r,'ssh_master_identity_changed');
     try{const encoded=compact.slice(start+prefix.length,end);if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)||Buffer.from(encoded,'base64').toString('base64')!==encoded)throw Error();r.master=JSON.parse(Buffer.from(encoded,'base64').toString());if(!Number.isSafeInteger(r.master.pid)||r.master.pid<1||typeof r.master.start!=='string'||! /^[0-9]+$/.test(r.master.start)||! /^[a-f0-9-]{36}$/.test(r.master.boot))throw Error();}catch{return lost(r,'ssh_master_identity_changed');}
     let offset=0,logical=0;while(offset<clean.length&&logical<end+suffix.length){if(!/[\r\n]/.test(clean[offset]))logical++;offset++;}marker=true;append(r,clean.slice(offset).replace(/^\r?\n/,''));initial='';
    });
    r.exit=new Promise(resolve=>{r.resolveExit=resolve;});r.terminal.onExit(()=>{r.alive=false;r.resolveExit();if(r.closeRequested)r.revision++;else if(r.status!=='closed')lost(r,'ssh_master_unavailable');});return view(r);
   }catch(error){if(r.status==='closed')return view(r);r.status=['ssh_route_requires_review'].includes(error.code)?'requires_review':['ssh_multiplex_unsupported','ssh_linux_client_namespace_required'].includes(error.code)?'unsupported':'unavailable';r.authentication='not_observed';r.error=error.code||'ssh_control_unavailable';r.revision++;return view(r);}})();opens.set(value.requestId,{signature,promise});return promise;
 }
 async function state(value){const r=ref(value);if(r.closeRequested&&!r.closeProof)await observeClose(r);if(r.status==='authenticated')try{await verified(r,true);}catch{}return view(r);}
 async function confirm(value){const r=ref(value);if(r.status==='authenticated')return state(value);if(r.status!=='authenticating'||!r.alive||!r.master)fail('ssh_authentication_unconfirmed');if(r.confirming)return r.confirming;const revision=r.revision;r.confirming=(async()=>{const proof=await host.check(r.profile,r.proof,r.master);if(closing||r.closeRequested||r.status!=='authenticating'||r.revision!==revision||!r.alive)fail('ssh_connection_changed');r.proof={...r.proof,...proof};r.status='authenticated';r.authentication='verified';r.revision++;r.ring=[];r.bytes=0;r.inputRequests.clear();return view(r);})();try{return await r.confirming;}finally{r.confirming=null;}}
 const loginCodes=new Set(['ssh_connection_changed','ssh_authentication_unconfirmed','ssh_master_identity_changed','ssh_master_unavailable','ssh_control_identity_changed','ssh_control_unavailable','ssh_control_timeout','ssh_control_output_limit','ssh_channel_unavailable','ssh_client_unavailable','ssh_invalid_profile','ssh_route_requires_review','ssh_multiplex_unsupported','ssh_linux_client_namespace_required','terminal_unavailable','terminal_start_failed','terminal_session_limit','terminal_service_active']);
 const loginCode=error=>loginCodes.has(error?.code)?error.code:({session_limit:'terminal_session_limit',spawn_failed:'terminal_start_failed',service_active:'terminal_service_active'})[error?.code]||'terminal_unavailable';
 function loginView(r){const active=['authenticating','authenticated'].includes(r.status)&&!r.closeRequested,login=active?r.loginState||{status:'waiting_authentication'}:{status:'failed',code:r.closeRequested||r.status==='closed'?'ssh_connection_changed':loginCode({code:r.error})},shell=r.loginShellId&&sessions.get(r.loginShellId)?.state();return {connection:view(r),...active&&login.status==='complete'&&shell?.alive&&!shell.closed?{shell}:{},login:{...login}};}
 // Pure observation of the original transaction, including a late ACK outcome.
 // It never proves a master, creates a channel or repeats login completion.
 function loginStatus(value){exact(value,['connectionId','requestId']);const r=ref({connectionId:value.connectionId});if(!id(value.requestId))fail('invalid_request',400);if(value.requestId!==r.loginRequestId)fail('request_changed');return loginView(r);}
 // Human login completion observes only this existing local master. Until its
 // control socket is ready, no slave channel may be launched.
 async function completeLogin(value){
  exact(value,['connectionId','requestId']);const r=ref({connectionId:value.connectionId});if(!id(value.requestId))fail('invalid_request',400);if(value.requestId!==r.loginRequestId)fail('request_changed');
  // A failed original transaction can still be observed. Do not replace its
  // actual startup/master error with an identity error or restart SSH here.
  if(!closing&&!r.closeRequested&&!r.profileUpdate&&['unavailable','unsupported','requires_review'].includes(r.status))return loginView(r);
  const allowed=()=>!closing&&!r.closeRequested&&r.alive&&!r.profileUpdate&&['authenticating','authenticated'].includes(r.status);if(!allowed())fail('ssh_connection_changed');if(r.loginCompletion)return r.loginCompletion.promise;
  const generation=r.generation,profile=r.profile,record={};const fresh=()=>{if(records.get(r.id)!==r||r.loginCompletion!==record||r.generation!==generation||r.profile!==profile||!allowed())fail('ssh_connection_changed');};r.loginCompletion=record;
  record.promise=(async()=>{
   r.loginState={status:'checking',phase:'checking_authentication'};
   fresh();if(r.status==='authenticating'){
    if(!r.proof||!r.master){r.loginState={status:'waiting_authentication'};return loginView(r);}
    let observed;try{if(typeof host.ready!=='function')fail('ssh_control_unavailable');observed=await host.ready(r.profile,r.proof,r.master);}catch(error){fresh();lost(r,error.code||'ssh_control_unavailable');throw error;}fresh();
    if(observed?.ready===false){r.loginState={status:'waiting_authentication'};return loginView(r);}if(observed?.ready!==true)fail('ssh_control_unavailable');
    await confirm({connectionId:r.id});fresh();
   }
   r.loginState={status:'checking',phase:'opening_shell'};
   if(r.loginShellId){await verified(r);fresh();r.loginState={status:'complete'};return loginView(r);}
   const shell=await openShell({connectionId:r.id,requestId:'login-shell-'+r.id},{assertCurrent:fresh});fresh();r.loginShellId=shell.id;r.loginState={status:'complete'};return loginView(r);
  })();try{return await record.promise;}catch(error){if(r.loginCompletion===record)r.loginState={status:'failed',phase:r.loginState?.phase||'checking_authentication',code:loginCode(error)};throw error;}finally{if(r.loginCompletion===record)r.loginCompletion=null;}
 }
 function authRead(value){const r=ref({connectionId:value.connectionId,...value.profileId?{profileId:value.profileId,profileVersion:value.profileVersion}:{}});exact(value,['connectionId','profileId','profileVersion','cursor','maxBytes'],['connectionId']);const cursor=value.cursor??0,max=value.maxBytes??65536;if(!Number.isSafeInteger(cursor)||cursor<0||cursor>r.sequence||!Number.isInteger(max)||max<16384||max>65536)fail('invalid_cursor',400);const first=r.ring[0]?.sequence??r.sequence+1;let bytes=0,output='',end=Math.max(cursor,first-1);for(const part of r.ring){if(part.sequence<=cursor)continue;const size=Buffer.byteLength(part.data);if(bytes+size>max)break;output+=part.data;bytes+=size;end=part.sequence;}return {connectionId:r.id,output,cursor:end,dropped:cursor<first-1,state:view(r)};}
 function authInput(value){const r=ref(value,['requestId','data']);if(r.status!=='authenticating'||!r.alive||closing)fail('ssh_authentication_not_pending');if(!id(value.requestId)||typeof value.data!=='string'||!value.data||value.data.includes('\0')||Buffer.byteLength(value.data)>8192)fail('invalid_input',400);const hash=digest(value.data),prior=r.inputRequests.get(value.requestId);if(prior){if(prior!==hash)fail('request_changed');return {accepted:true,connectionId:r.id,requestId:value.requestId,duplicate:true};}if(r.inputRequests.size>=2048)fail('request_limit');r.terminal.write(value.data);r.inputRequests.set(value.requestId,hash);return {accepted:true,connectionId:r.id,requestId:value.requestId};}
 function authResize(value){const r=ref(value,['cols','rows']);if(r.status!=='authenticating'||!r.alive)fail('ssh_authentication_not_pending');if(!Number.isInteger(value.cols)||value.cols<10||value.cols>500||!Number.isInteger(value.rows)||value.rows<2||value.rows>300)fail('invalid_size',400);r.terminal.resize(value.cols,value.rows);return {connectionId:r.id,resized:true};}
 async function openShell(value,{assertCurrent=()=>{}}={}){const r=ref(value,['requestId']);assertCurrent();if(!id(value.requestId))fail('invalid_request',400);if(r.shellRequests.has(value.requestId))return r.shellRequests.get(value.requestId);const promise=(async()=>{await verified(r);assertCurrent();if([...sessions.values()].filter(s=>s.state().alive&&!s.state().closed).length>=4)fail('session_limit');const session=sessionFactory({pty,connectionId:r.id,plan:{kind:'ssh',mode:r.profile.mode||'interactive',name:'SSH terminal',launch:host.slaveLaunch(r.profile,r.proof)},now,serviceTimeouts});if(r.status!=='authenticated'||closing){session.dispose();fail('ssh_connection_changed');}sessions.set(session.state().id,session);r.shells.add(session.state().id);r.revision++;return session.state();})();r.shellRequests.set(value.requestId,promise);return promise;}
 function serviceView(r){if(r.service?.shared)return {connectionId:r.id,profileId:r.profile.id,profileVersion:r.profile.version,attemptId:r.service.requestId,...r.service.shared.view()};const state=r.service?.session?.serviceState(),opening=r.service&&!r.service.started&&!r.service.failure;return {connectionId:r.id,profileId:r.profile.id,profileVersion:r.profile.version,status:r.service?.failure?'failed':opening?'connecting':state?.serviceStatus||'idle',serviceActive:!r.service?.failure&&(opening||state?.serviceActive===true)||false,...state?.serviceId?{serviceId:state.serviceId}:{},...r.service?{attemptId:r.service.requestId}:{},...Object.fromEntries(['service','servicePhase','progress','error'].filter(k=>state?.[k]!==undefined).map(k=>[k,state[k]])),...opening?{servicePhase:'preparing_local'}:{},...r.service?.failure?{servicePhase:'preparing_local',error:{code:r.service.failure,phase:'preparing_local'}}:{}};}
 async function openService(value){exact(value,['connectionId','profileId','profileVersion','requestId','bootstrap','terminalSessionId','terminalOwnerEpoch','terminalScope','interactiveService'],['connectionId','requestId','bootstrap']);if(value.interactiveService!==undefined&&(value.interactiveService!==true||value.terminalSessionId!==undefined))fail('invalid_request',400);const r=ref({connectionId:value.connectionId,...value.profileId?{profileId:value.profileId,profileVersion:value.profileVersion}:{}});expireProfileUpdates();if(r.profileUpdate)fail('service_active',423);if(!id(value.requestId))fail('invalid_request',400);if(r.cancelled.has(value.requestId))fail('service_start_cancelled');const signature=digest([value.bootstrap,value.interactiveService===true,value.terminalSessionId]);if(r.service){if(r.service.requestId===value.requestId){if(r.service.signature!==signature)fail('request_changed');return r.service.promise;}if(r.service.shared?r.service.shared.view().serviceActive:!r.service.failure&&(!r.service.started||r.service.session.serviceState().serviceActive))fail('service_active',423);if(!r.service.shared)r.service.session?.dispose();}const record={requestId:value.requestId,signature};r.service=record;r.revision++;
  if(value.terminalSessionId!==undefined){const session=sessions.get(value.terminalSessionId);if(!r.shells.has(value.terminalSessionId)||!session)fail('session_not_found');const authorization={ownerEpoch:value.terminalOwnerEpoch,scope:value.terminalScope};record.shared=sharedShellService({session,sessionId:value.terminalSessionId,bootstrap:value.bootstrap,requestId:value.requestId,authorization,assertCurrent:()=>{if(r.service!==record||r.status!=='authenticated'||closing)fail('service_changed');}});record.promise=(async()=>{await verified(r);await record.shared.start();return serviceView(r);})();return record.promise;}record.promise=(async()=>{try{await verified(r);if(r.service!==record||r.cancelled.has(value.requestId))fail('service_start_cancelled');const marker='__STUDIO_CHANNEL_READY_'+randomBytes(24).toString('hex')+'__';const session=record.session=sessionFactory({pty,privateServiceChannel:true,plan:{kind:'ssh',mode:r.profile.mode||'interactive',name:'Private SSH service',launch:host.slaveLaunch(r.profile,r.proof,value.interactiveService?undefined:"printf '%s\\n' '"+marker+"'; exec /bin/sh -i")},now,serviceTimeouts});
   if(value.interactiveService){
    // Interactive gateways may refuse an SSH exec command. This private slave
    // stays logged in with the verified master and carries successive requests.
    await session.waitShellReady(()=>{if(closing||r.service!==record||r.status!=='authenticated'||r.cancelled.has(value.requestId))fail('service_start_cancelled');});
   }else{
   const deadline=Date.now()+10000;let cursor=0,found=false,carry='';while(Date.now()<deadline){if(r.service!==record||r.status!=='authenticated'||r.cancelled.has(value.requestId)||closing){session.dispose();fail('service_start_cancelled');}const s=session.state();const read=session.read({actor:'human',ownerEpoch:s.ownerEpoch,cursor,maxBytes:65536});cursor=read.cursor;carry=(carry+read.chunks.map(c=>c.data).join('')).slice(-8192);if(/exec request failed|exec request[^\r\n]*(?:denied|not allowed)/i.test(carry))fail('exec_unavailable');if(/session open refused|administratively prohibited/i.test(carry))fail('channel_refused');if(!s.alive)fail('channel_refused');if(carry.replace(/\x1b\](?:0|2);[^\x00-\x1f\x7f]{0,512}\x07/g,'').replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').split(/\r?\n/).some(line=>line.replace(/ {1,500}$/,'')===marker)){found=true;break;}await wait(20);}if(!found){session.dispose();fail('ssh_channel_unavailable');}
   }
   record.started=true;try{await session.serviceStart({ownerEpoch:session.state().ownerEpoch,requestId:value.requestId,bootstrap:value.bootstrap});}catch(error){if(!session.serviceState().serviceId)throw error;}if(r.service!==record||r.status!=='authenticated'||closing)fail('ssh_connection_changed');return serviceView(r);
  }catch(error){if(r.service===record&&!record.started&&['exec_unavailable','channel_refused','ssh_channel_unavailable'].includes(error.code)){record.failure=error.code==='ssh_channel_unavailable'?'channel_timeout':error.code;record.session?.dispose();r.revision++;return serviceView(r);}throw error;}})();return record.promise;
 }
 async function serviceState(value){exact(value,['connectionId','serviceId','profileId','profileVersion'],['connectionId']);const r=ref({connectionId:value.connectionId,...value.profileId?{profileId:value.profileId,profileVersion:value.profileVersion}:{}});if(value.serviceId!==undefined&&value.serviceId!==serviceView(r).serviceId)fail('service_changed');if(r.status==='authenticated')try{await verified(r,true);}catch{}return serviceView(r);}
 async function serviceRequest(value){const r=ref({connectionId:value.connectionId});await verified(r);const record=r.service;if(record?.shared){const {connectionId,terminalOwnerEpoch,terminalScope,...request}=value;return record.shared.request(request,{ownerEpoch:terminalOwnerEpoch,scope:terminalScope});}if(!record?.session||record.session.serviceState().serviceId!==value.serviceId)fail('service_changed');const {connectionId,...request}=value,result=await record.session.serviceRequest(request);if(r.service!==record||r.status!=='authenticated')fail('service_changed');return result;}
 async function closeService(value){exact(value,['connectionId','serviceId']);const r=ref({connectionId:value.connectionId}),record=r.service;if(record?.shared){if(value.serviceId!==record.shared.view().serviceId)fail('service_changed');await record.shared.close();return serviceView(r);}if(!record?.session||record.session.serviceState().serviceId!==value.serviceId)fail('service_changed');await record.session.serviceStop({serviceId:value.serviceId});if(r.service!==record)fail('service_changed');const result=serviceView(r);if(!result.serviceActive){record.session.dispose();r.revision++;}return result;}
 async function cancelServiceStart(value){const r=ref(value,['requestId']);if(r.profileUpdate){profileUpdates.get(r.profileUpdate)?.invalid?.();r.profileUpdate=null;}if(!id(value.requestId))fail('invalid_request');if(!r.cancelled.has(value.requestId)&&r.cancelled.size>=64)fail('request_limit',429);r.cancelled.add(value.requestId);const record=r.service;if(record?.requestId===value.requestId){if(record.shared){await record.shared.cancel();}else if(record.session){await record.session.serviceCancelStart({requestId:value.requestId});if(!record.session.serviceState().serviceActive)record.session.dispose();}else r.service=null;r.revision++;}return {...serviceView(r),cancelled:true,cancelledAttemptId:value.requestId};}
 async function observeClose(r){
  if(!r.closeRequested||r.closeProof||r.alive&&r.terminal)return r.closeProof===true;
  let proved=!r.terminal;try{if(r.proof&&typeof host.observeClosed==='function')proved=(await host.observeClosed(r.profile,r.proof,r.master)).closed===true;else if(r.closeExitProven)proved=true;}catch{proved=false;}
  if(proved&&!r.closeProof){r.closeProof=true;r.status='closed';r.revision++;if(!r.cleanupPending)delete r.error;}return r.closeProof===true;
 }
 async function close(value){
  const r=ref(value);if(r.profileUpdate){profileUpdates.get(r.profileUpdate)?.invalid?.();r.profileUpdate=null;}if(r.closing)return r.closing;if(r.closeProof&&!r.cleanupPending)return {...view(r),closed:true,closedSessionIds:[...r.shells],closedServiceIds:r.closedServiceIds||[]};
  r.generation++;r.closeRequested=true;r.closeProof=false;r.status='unavailable';r.authentication=r.authentication==='verified'?'lost':r.authentication==='pending'?'not_observed':r.authentication;r.error='ssh_close_unconfirmed';r.revision++;r.ring=[];r.bytes=0;const closedSessionIds=[...r.shells],closedServiceIds=r.service?.session?.serviceState().serviceId?[r.service.session.serviceState().serviceId]:r.closedServiceIds||[];r.closedServiceIds=closedServiceIds;
  for(const id of r.shells){sessions.get(id)?.dispose();sessions.delete(id);}r.service?.session?.dispose();
  const operation=(async()=>{
   try{if(r.master&&r.proof)r.closeExitProven=(await host.close(r.profile,r.proof,r.master))?.closed!==false;else if(!r.terminal)r.closeExitProven=true;}catch{r.closeExitProven=false;}
   try{if(r.alive)r.terminal?.kill();}catch{}if(r.exit)await Promise.race([r.exit,wait(closeWaitMs)]);
   await observeClose(r);if(r.closeProof&&r.proof){try{await host.cleanup(r.profile,r.proof);r.cleanupPending=false;delete r.error;}catch{r.cleanupPending=true;r.closeProof=false;r.status='unavailable';r.error='ssh_close_cleanup_unconfirmed';r.revision++;}}
   return {...view(r),closed:r.closeProof===true,closedSessionIds,closedServiceIds};
  })();r.closing=operation;try{return await operation;}finally{if(r.closing===operation)r.closing=null;}
 }
 // A broker lock orders environment-only adoption against new slave/service
 // starts. It never freezes independent human shell input or terminates a job.
 function profileBody(p){const {version,serviceEnvironment,...rest}=p;return rest;}
 function finishProfileUpdate(token,status){const record=profileUpdates.get(token);if(!record||record.status!=='prepared')return;clearTimeout(record.timer);for(const r of record.rows)if(r.profileUpdate===token)r.profileUpdate=null;record.status=status;record.valid=false;record.rows=[];record.snapshot=[];record.next=null;record.timer=null;}
 function expireProfileUpdates(){for(const [token,record]of profileUpdates)if(record.status==='prepared'&&now()>=record.expiresAt)finishProfileUpdate(token,'expired');}
 function prepareProfileUpdate(value){
  exact(value,['token','profileId','previousVersion','next']);if(!id(value.token)||value.next?.id!==value.profileId||!Number.isSafeInteger(value.previousVersion))fail('invalid_request');expireProfileUpdates();
  const signature=digest([value.profileId,value.previousVersion,value.next]),previous=profileUpdates.get(value.token);if(previous){if(previous.signature!==signature&&previous.signature!==null)fail('request_changed');if(previous.status!=='prepared')fail('ssh_connection_changed');return structuredClone(previous.result);}
  if(profileUpdates.size>=256)fail('request_limit',429);
  const rows=[...records.values()].filter(r=>r.profile.id===value.profileId&&!['closed','unsupported','requires_review'].includes(r.status));for(const r of rows){if(r.profile.version!==value.previousVersion||r.status!=='authenticated'||r.profileUpdate||r.service&&!r.service.session||r.service?.session?.serviceState().serviceActive||!equal(profileBody(r.profile),profileBody(value.next)))fail('service_active',423);}
  const token=value.token,snapshot=rows.map(r=>({id:r.id,revision:r.revision})),result={token,connectionIds:rows.map(r=>r.id)},record={rows,snapshot,next:structuredClone(value.next),signature,result,status:'prepared',expiresAt:now()+profileUpdateLeaseMs,valid:true,invalid(){finishProfileUpdate(token,'invalid');}};
  for(const r of rows)r.profileUpdate=token;profileUpdates.set(token,record);record.timer=setTimeout(()=>finishProfileUpdate(token,'expired'),profileUpdateLeaseMs);record.timer.unref?.();return structuredClone(result);
 }
 function abortProfileUpdate(value){exact(value,['token']);if(!id(value.token))fail('invalid_request');expireProfileUpdates();if(!profileUpdates.has(value.token)){if(profileUpdates.size>=256)fail('request_limit',429);profileUpdates.set(value.token,{signature:null,status:'aborted'});}else finishProfileUpdate(value.token,'aborted');return {aborted:true};}
 function commitProfileUpdate(value){
  exact(value,['token','profile']);expireProfileUpdates();const record=profileUpdates.get(value.token);if(!record||record.status!=='prepared'||!record.valid||!equal(record.next,value.profile)||record.snapshot.some(({id,revision})=>{const r=records.get(id);return !r||r.revision!==revision||r.profileUpdate!==value.token||r.status!=='authenticated'||r.service?.session?.serviceState().serviceActive;}))fail('ssh_connection_changed');
  const ids=record.rows.map(r=>r.id);for(const r of record.rows){r.profile=structuredClone(value.profile);r.generation++;r.revision++;}finishProfileUpdate(value.token,'committed');return {connectionIds:ids};
 }
 // Profile transactions call these only after saving an environment-only edit.
 function profileFacts(profileId){return [...records.values()].filter(r=>r.profile.id===profileId&&r.status!=='closed').map(r=>({connectionId:r.id,profileVersion:r.profile.version,revision:r.revision,status:r.status,serviceActive:!!(r.service?.shared?r.service.shared.view().serviceActive:r.service?.session?.serviceState().serviceActive),servicePending:!!r.service&&!r.service.shared&&!r.service.session}));}
 function updateProfile(value){exact(value,['connectionIds','previousVersion','profile'],['connectionIds','previousVersion','profile']);if(!Array.isArray(value.connectionIds))fail('invalid_request');const body=p=>{const {version,serviceEnvironment,...rest}=p;return rest;};const rows=value.connectionIds.map(id=>{const r=records.get(id);if(!r||r.profile.id!==value.profile.id||r.profile.version!==value.previousVersion||r.status!=='authenticated'||r.service?.session?.serviceState().serviceActive||r.service&&!r.service.session||!equal(body(r.profile),body(value.profile)))fail('ssh_connection_changed');return r;});for(const r of rows){r.profile=structuredClone(value.profile);r.generation++;r.revision++;}return {connectionIds:rows.map(r=>r.id)};}
 return {withShell(sessionId,fn){for(const r of records.values())if(r.service?.shared?.sessionId===sessionId)return r.service.shared.shell(fn);return fn();},open,list:()=>({connections:[...records.values()].map(view)}),state,confirm,completeLogin,loginStatus,authRead,authInput,authResize,openShell,openService,serviceState,serviceRequest,closeService,cancelServiceStart,close,profileFacts,updateProfile,prepareProfileUpdate,commitProfileUpdate,abortProfileUpdate,async closeAll(){closing=true;for(const token of profileUpdates.keys())finishProfileUpdate(token,'closed');await Promise.allSettled([...records.values()].map(r=>close({connectionId:r.id})));}};
}
