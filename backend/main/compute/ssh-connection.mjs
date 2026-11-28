import {randomBytes,randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {taskWorkerSource,validTaskWorkerSource,sameWorkerBinding} from "../../../contracts/compute/task-worker-binding.mjs";
import {preparedProjectId} from '../../../contracts/compute/deployment.mjs';


const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const typed=(value,keys)=>{if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('Invalid private SSH request');};
export const sshConnectionReview=p=>({host:p.host,username:p.username,port:Number(p.port),identity_file:p.identity_file||'',ssh_client:p.ssh_client,auth_mode:p.auth_mode||'key',proxy_jump:p.proxy_jump||[],via:p.via||[]});
export const sshOwner=value=>value?.threadId?{provider:value.provider,threadId:value.threadId,taskId:value.taskId||null}:null;
export function sshTaskSource(records,selection,request){
 const current=selection(),taskId=request?.kind==='original-run'?request.taskId:current?.taskId;
 if(!taskId)return null;
 let task;try{task=records.read(taskId);}catch{throw Error('original_run_unavailable');}
 if(task.id!==current?.taskId||task.provider!==current?.provider||task.threadId!==current?.threadId)throw Error('original_run_changed');
 const value={taskId,source:taskWorkerSource(task)};
 if(request?.kind==='original-run'){
  const artifact=task.artifacts?.find(item=>item.kind==='cluster-run'&&item.id===request.runId);
  if(!artifact)throw Error('original_run_unavailable');
  value.artifact={id:artifact.id,kind:artifact.kind};
  if(task.deployment?.prepared?.artifactId===request.runId)value.preparedProject=preparedProjectId(task);
  else if(artifact.projectId)value.preparedProject=artifact.projectId;
 }
 return value;
}
export function assertSshSource(source,worker){if(source&&(!validTaskWorkerSource(source.source)||!sameWorkerBinding(source.source.binding,worker)))throw Error('needs_original_worker');}
export const requiresCurrentSshWorker=p=>p?.auth_mode==='interactive'||Array.isArray(p?.proxy_jump)&&p.proxy_jump.length>0;
export async function requireCurrentSshWorker(worker,observe){const connection=worker.connection,epoch=worker.connectionEpoch;const status=await observe();if(!connection||worker.connection!==connection||worker.connectionEpoch!==epoch||status?.status!=='connected'||status.serviceVersion!=='current')throw Error('needs_worker_update');}
const codes=new Set(['original_run_unavailable','original_run_changed','original_run_policy_blocked','key_check_failed','historical_forward_disabled','needs_worker_update','needs_original_worker','interactive_jump_identity_required','saved_connection_changed','saved_connection_unavailable','needs_human_auth','auth_expired','auth_process_exited','auth_process_unavailable','interactive_client_unsupported','interactive_legacy_via_unsupported','linux_client_and_key_namespace_required','interactive_client_options_unsupported','interactive_config_proxy_unsupported','interactive_client_unavailable','private_linux_control_root_unavailable','client_or_config_changed','auth_session_limit','owned_forward_failed','tunnel_limit','invalid_loopback_forward']);
const safe=error=>codes.has(error?.message)?error.message:'private_ssh_operation_failed';
const publicFields=['sessionId','clusterId','version','name','status','reason','authenticated','observedAt','leaseSeconds','scientificValidation','authMode','keyCheckStatus','newForwardAllowed'];
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));

/** Only this private owner receives TTY bytes. No catalog/event/Agent integration. */
export function createSshConnection({worker,selection,revision,beforeStart=()=>{},sourceScope=()=>null,assertSource=()=>{},validateRunReceipt=()=>{},observeWorker=async()=>({status:'unknown'}),id=randomUUID,secret=()=>randomBytes(24).toString('hex')}){
 let pane=null,privacyRevision=0;
 const capture=request=>({connection:worker.connection,epoch:worker.connectionEpoch,identity:structuredClone(worker.identity),target:structuredClone(worker.connectionTarget),runtime:worker.connection?.health?.runtime,source:worker.connectedSource,bundled:worker.bundledRuntimeId,owner:structuredClone(selection()),revision:revision(),taskSource:structuredClone(sourceScope(request))});
 const workerCurrent=p=>worker.connection===p.context.connection&&worker.connectionEpoch===p.context.epoch&&equal(worker.identity,p.context.identity)&&equal(worker.connectionTarget,p.context.target)&&worker.connection?.health?.runtime===p.context.runtime&&worker.connectedSource===p.context.source&&worker.bundledRuntimeId===p.context.bundled;
 const current=p=>{try{return pane===p&&!p.finished&&!p.retiring&&workerCurrent(p)&&p.context.revision===revision()&&equal(p.context.owner,selection())&&equal(p.context.taskSource,sourceScope(p.request));}catch{return false;}};
 const fields=p=>({paneId:p.id,paneEpoch:p.epoch,...p.view});
 function owned(data,event,extra=[]){typed(data,['paneId','paneEpoch',...extra]);if(!pane||pane.retiring||data.paneId!==pane.id||data.paneEpoch!==pane.epoch||event.sender!==pane.sender||event.senderFrame!==pane.frame||event.sender.isDestroyed?.())throw Error('Private SSH pane is unavailable');return pane;}
 async function request(p,path,data){if(!workerCurrent(p))throw Error('needs_human_auth');return worker.request('POST',path,data);}
 async function cancel(p){const retain=p.preexistingVerified||p.view.authenticated===true||p.retainedOnCancel;p.retainedOnCancel=!!retain;if(p.pendingForward&&workerCurrent(p))try{await request(p,'/api/cluster/tunnel/close',{tunnel_id:p.pendingForward,owner:p.secret});}catch{}if(p.sessionId&&workerCurrent(p))try{await request(p,'/api/cluster/auth/finish',{session_id:p.sessionId,owner:p.secret,retain:!!retain});}catch{}p.view={...p.view,status:'needs_human_auth',reason:'source_changed',authenticated:false};}
 async function scoped(p,run){if(!current(p)){await cancel(p);return fields(p);}try{const value=await run();if(!current(p)){await cancel(p);return fields(p);}return value;}catch(error){if(!current(p)){await cancel(p);return fields(p);}p.view={...p.view,status:'blocked',reason:safe(error),authenticated:false};return fields(p);}}
 function acquire(event,request){if(pane)throw Error('Close the current private SSH pane first');if(!worker.connection||!event?.sender||!event.senderFrame||event.senderFrame.parent||event.sender.isLoadingMainFrame?.())throw Error('Verified worker and owning main frame required');let context;try{context=capture(request);}catch{throw Error('The original worker source is unavailable');}const p={id:id(),epoch:++privacyRevision,secret:secret(),sender:event.sender,frame:event.senderFrame,request,context,view:{status:'loading'},finished:false};pane=p;return p;}
 function accept(p,value,checkSource=true){
  if(p.originalRun){const receipt=value?.sourceReceipt;if(!object(receipt)||receipt.runId!==p.request.runId||typeof receipt.nonce!=='string'||!receipt.nonce||receipt.nonce.length>256||typeof receipt.projectId!=='string'||!receipt.projectId||typeof receipt.clusterId!=='string'||!receipt.clusterId||!Number.isInteger(receipt.version)||receipt.version<1||!/^[a-f0-9]{64}$/.test(receipt.snapshotDigest||'')||value.clusterId!==receipt.clusterId||value.version!==receipt.version)throw Error('original_run_changed');if(p.sourceReceipt&&!equal(p.sourceReceipt,receipt))throw Error('original_run_changed');if(checkSource)validateRunReceipt(p.request,receipt);p.sourceReceipt=structuredClone(receipt);}
  if(current(p)||!checkSource)p.view=pick(value,publicFields);
 }
 async function plan(data,event){
  const originalRun=data?.kind==='original-run';typed(data,originalRun?['kind','runId','taskId','owner']:['kind','clusterId','version','expected','owner']);
  if(originalRun){if(typeof data.runId!=='string'||!data.runId||data.runId.length>200||data.taskId!==undefined&&(typeof data.taskId!=='string'||!data.taskId||data.taskId.length>200))throw Error('Select an existing run');}
  else if(data.kind!==undefined&&data.kind!=='saved-profile'||typeof data.clusterId!=='string'||!data.clusterId||!Number.isInteger(data.version)||!object(data.expected))throw Error('Select an unchanged saved SSH connection');
  if(!equal(data.owner,sshOwner(selection())))throw Error('Selected workflow changed before private authentication');
  const p=acquire(event,data);p.originalRun=originalRun;
  return scoped(p,async()=>{assertSource(data);await requireCurrentSshWorker(worker,observeWorker);let value;
   if(originalRun)value=await request(p,'/api/cluster/auth/plan',{run_id:data.runId,owner:p.secret});
   else{const profile=await request(p,'/api/cluster/profile',{cluster_id:data.clusterId});if(!current(p))return fields(p);if(profile.version!==data.version||!equal(data.expected,sshConnectionReview(profile))){p.view={status:'blocked',reason:'saved_connection_changed'};return fields(p);}value=await request(p,'/api/cluster/auth/plan',{cluster_id:profile.id,version:profile.version,owner:p.secret});}
   p.sessionId=value.sessionId;p.preexistingVerified=value.authenticated===true;p.tunnelIds=new Set((value.tunnels||[]).map(t=>t.tunnelId));accept(p,value);return {...fields(p),review:value.review,clientRoute:value.clientRoute,tunnels:value.tunnels||[],origin:value.origin,newForwardAllowed:originalRun?false:value.newForwardAllowed!==false};});
 }
 async function start(data,event){const p=owned(data,event,['requestId']);if(typeof data.requestId!=='string'||!data.requestId||data.requestId.length>100)throw Error('Invalid private SSH request');return scoped(p,async()=>{beforeStart();const value=await request(p,'/api/cluster/auth/start',{session_id:p.sessionId,owner:p.secret,request_id:data.requestId});accept(p,value);return fields(p);});}
 async function read(data,event){const p=owned(data,event,['cursor']);if(!Number.isSafeInteger(data.cursor)||data.cursor<0)throw Error('Invalid private SSH cursor');return scoped(p,async()=>{const value=await request(p,'/api/cluster/auth/read',{session_id:p.sessionId,owner:p.secret,cursor:data.cursor});accept(p,value);return {...fields(p),...pick(value,['privateOutput','cursor','dropped'])};});}
 async function input(data,event){const p=owned(data,event,['data','sequence']);if(typeof data.data!=='string'||Buffer.byteLength(data.data)>4096||!Number.isSafeInteger(data.sequence))throw Error('Invalid private SSH input');return scoped(p,async()=>{await request(p,'/api/cluster/auth/input',{session_id:p.sessionId,owner:p.secret,data:data.data,sequence:data.sequence});return {accepted:true};});}
 async function resize(data,event){const p=owned(data,event,['rows','cols']);if(!Number.isInteger(data.rows)||!Number.isInteger(data.cols)||data.rows<2||data.rows>300||data.cols<10||data.cols>500)throw Error('Invalid private SSH dimensions');return scoped(p,async()=>{await request(p,'/api/cluster/auth/resize',{session_id:p.sessionId,owner:p.secret,rows:data.rows,cols:data.cols});return {accepted:true};});}
 async function finish(data,event){const p=owned(data,event,['retain','end']);if(typeof data.retain!=='boolean'||Object.hasOwn(data,'end')&&(data.end!==true||data.retain!==false))throw Error('Invalid private SSH finish');if(p.finished)return fields(p);try{if(p.sessionId){const retain=data.end===true?false:current(p)?data.retain:!!(p.preexistingVerified||p.view.authenticated||p.retainedOnCancel);const value=await request(p,'/api/cluster/auth/finish',{session_id:p.sessionId,owner:p.secret,retain});accept(p,value,false);}}catch(error){p.view={status:'needs_human_auth',reason:safe(error),authenticated:false};if(workerCurrent(p))throw Error('Private authentication cleanup is unconfirmed');}p.finished=true;return fields(p);}
 function closed(data,event){const p=owned(data,event);if(!p.finished)throw Error('Private SSH cleanup is not confirmed');pane=null;privacyRevision++;return {closed:true};}
 async function tunnelPlan(data,event){const p=owned(data,event,['clusterId','version','localPort','destinationHost','destinationPort']);return scoped(p,async()=>{if(p.originalRun)return {...fields(p),reason:'historical_forward_disabled'};if(data.clusterId!==p.view.clusterId||data.version!==p.view.version)throw Error('saved_connection_changed');const value=await request(p,'/api/cluster/tunnel/plan',{cluster_id:data.clusterId,version:data.version,owner:p.secret,local_port:data.localPort,destination_host:data.destinationHost,destination_port:data.destinationPort});p.tunnelIds.add(value.tunnelId);return {...fields(p),tunnel:value};});}
 async function tunnelAction(action,data,event){const p=owned(data,event,action==='start'?['requestId','tunnelId']:['tunnelId']);const result=await scoped(p,async()=>{if(!p.tunnelIds?.has(data.tunnelId))throw Error('tunnel_unavailable');if(action==='start'){beforeStart();p.pendingForward=data.tunnelId;}const value=await request(p,'/api/cluster/tunnel/'+action,{tunnel_id:data.tunnelId,owner:p.secret,...action==='start'?{request_id:data.requestId}:{}});return {...fields(p),tunnel:value};});if(current(p))p.pendingForward=null;return result;}
 function destroyed(sender){if(pane?.sender===sender&&sender.isDestroyed?.()){const p=pane;void cancel(p);p.finished=true;pane=null;privacyRevision++;}}
 function invalidateFrame(sender){if(pane?.sender===sender){pane.retiring=++privacyRevision;void cancel(pane);}}
 function retirement(sender){return pane?.sender===sender&&pane.retiring?{paneId:pane.id,paneEpoch:pane.epoch,retirement:pane.retiring}:null;}
 function retireFrame(sender,ticket){if(pane?.sender!==sender||!pane.retiring||ticket?.paneId!==pane.id||ticket.paneEpoch!==pane.epoch||ticket.retirement!==pane.retiring)return false;pane.finished=true;pane=null;privacyRevision++;return true;}
 return {plan,start,read,input,resize,finish,closed,tunnelPlan,tunnelStart:(d,e)=>tunnelAction('start',d,e),tunnelStatus:(d,e)=>tunnelAction('status',d,e),tunnelClose:(d,e)=>tunnelAction('close',d,e),destroyed,invalidateFrame,retirement,retireFrame,shutdown:()=>{if(pane&&!pane.finished)void cancel(pane);},privacy:()=>({active:!!pane,revision:privacyRevision})};
}

/** Release a crashed/reloaded private frame only after the new main document paints. */
export function installSshPrivacyLifecycle(contents,controller){
 let generation=0,pending=null;
 const begin=()=>{generation++;controller.invalidateFrame(contents);const ticket=controller.retirement(contents);pending=ticket?{generation,ticket,committed:null}:null;};
 const sameFrame=commit=>{try{const frame=contents.mainFrame;return frame===commit.frame&&!frame.detached&&!frame.isDestroyed()&&frame.processId===commit.processId&&frame.routingId===commit.routingId&&frame.frameToken===commit.frameToken;}catch{return false;}};
 contents.on('did-start-navigation',(_event,_url,inPlace,isMainFrame)=>{if(isMainFrame&&!inPlace)begin();});
 contents.on('render-process-gone',begin);
 contents.on('destroyed',()=>{pending=null;controller.destroyed(contents);});
 contents.on('did-frame-navigate',(_event,_url,_response,_text,isMainFrame,processId,routingId)=>{if(!isMainFrame||!pending)return;try{const frame=contents.mainFrame;if(!frame||frame.detached||frame.isDestroyed()||frame.processId!==processId||frame.routingId!==routingId||typeof frame.frameToken!=='string'||!frame.frameToken)return;pending.committed={frame,processId,routingId,frameToken:frame.frameToken};}catch{}});
 contents.on('did-frame-finish-load',async(_event,isMainFrame,processId,routingId)=>{const navigation=pending,commit=navigation?.committed;if(!isMainFrame||!commit||commit.processId!==processId||commit.routingId!==routingId||!sameFrame(commit))return;try{await commit.frame.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))');if(pending===navigation&&generation===navigation.generation&&!contents.isDestroyed()&&sameFrame(commit)){controller.retireFrame(contents,navigation.ticket);pending=null;}}catch{/* Keep capture blocked until a replacement committed document paints. */}});
}
