import {isDeepStrictEqual as equal} from 'node:util';
/** Route independently granted capabilities of the explicitly selected resource. */
export function createAgentResourceRouting({worker,terminal,resource,sharedTerminal,agents,service=()=>null}){
 const handoffHints=new Map();
 function assertHandoffComplete(provider){if(handoffHints.has(provider))throw Error('请等待当前能力交接完成；未发送或重发请求。');}
 const selected=()=>resource()?.peek()||null,controller=()=>typeof service==='function'?service():service;
 const connection=()=>{const v=selected();return v?.schemaVersion===2&&v.kind==='ssh-connection'?v:null;};
 const legacy=()=>selected()?.kind==='ssh-terminal';
 function selectedService(){const v=connection(),s=controller()?.peek?.();return v&&s?.connectionId===v.connectionId&&s.profileId===v.profileId&&s.profileVersion===v.profileVersion?s:null;}
 function readyService(){const v=connection();if(!v)return false;const s=selectedService(),i=worker?.identity,t=worker?.connectionTarget;return !!(s?.status==='connected'&&s.workflowReady===true&&worker?.connection&&i?.kind==='ssh'&&i.version===3&&i.connectionId===v.connectionId&&i.profileId===v.profileId&&i.profileVersion===v.profileVersion&&t?.connectionId===v.connectionId&&t.serviceId===s.serviceId);}
 const serviceGranted=provider=>controller()?.hasCurrentGrant?.(provider)===true;
 const shellGranted=provider=>!!(connection()&&sharedTerminal()?.hasCurrentGrant(provider));
 const workerSelected=provider=>readyService()&&(provider===undefined||serviceGranted(provider));
 function capture(){const port=resource(),ticket=port?.capture();return {selection:ticket?.selection||null,assertCurrent:()=>{if(port!==resource())throw Error('compute_resource_selection_changed');if(ticket)port.assertCurrent(ticket);}};}
 function prepareHandoff({provider,capability,connectionId,attemptId,sessionId}){
  if(!['codex','kimi','qwen','deepseek','compatible'].includes(provider)||!['service','terminal'].includes(capability))throw Error('compute_resource_handoff_invalid');
  const selected=connection(),state=selectedService(),ticket=capture();if(!selected||selected.connectionId!==connectionId||capability==='service'&&(!readyService()||state.attemptId!==attemptId)||capability==='terminal'&&(typeof sessionId!=='string'||!sessionId))throw Error('compute_resource_handoff_changed');
  // This is discovery routing inside a human handoff, never a usage grant.
  const target=capability==='terminal'&&serviceGranted(provider)?'service':capability,entry={target,ticket,connectionId,serviceId:state?.serviceId,attemptId:state?.attemptId,workerConnection:worker?.connection,workerIdentity:structuredClone(worker?.identity),workerTarget:structuredClone(worker?.connectionTarget)};handoffHints.set(provider,entry);
  const assertCurrent=()=>{ticket.assertCurrent();if(handoffHints.get(provider)!==entry||connection()?.connectionId!==connectionId)throw Error('compute_resource_handoff_changed');if(target==='service'){const actual=selectedService();if(!readyService()||capability==='terminal'&&!serviceGranted(provider)||actual?.serviceId!==entry.serviceId||actual.attemptId!==entry.attemptId||worker.connection!==entry.workerConnection||!equal(worker.identity,entry.workerIdentity)||!equal(worker.connectionTarget,entry.workerTarget))throw Error('compute_resource_handoff_changed');}};
  entry.assertCurrent=assertCurrent;
  return {assertCurrent,release:()=>{if(handoffHints.get(provider)===entry)handoffHints.delete(provider);}};
 }
 function providerConnection(provider){if(legacy())return undefined;if(connection()){const hint=handoffHints.get(provider);if(hint){hint.assertCurrent();return hint.target==='service'?worker.providerConnection(provider):terminal()?.providerConnection(provider);}return readyService()&&(serviceGranted(provider)||!shellGranted(provider))?worker.providerConnection(provider):terminal()?.providerConnection(provider);}return worker.providerConnection(provider)||terminal()?.providerConnection(provider);}
 function bindWorkerContext(provider,context,options){
  controller()?.reconcileContext?.();sharedTerminal()?.reconcileContext?.();
  const local=terminal()?.bindProviderContext(provider,context,options);let binding=local;
  if(!connection()&&!legacy()||readyService())binding=worker.bindProviderContext(provider,context,options)||local;
  const previous=agents()?.bridgeWorkers?.get(provider),next=providerConnection(provider),changed=!!previous!==!!next||previous&&(previous.url!==next?.url||previous.transport!==next?.transport||previous.tokens?.mcp!==next?.tokens?.mcp);
  return changed?{...binding,rotated:true}:binding;
 }
 function scope(provider,method){const ticket=capture(),route=workerSelected(provider)?'service':shellGranted(provider)?'shell':null;return {assertCurrent:()=>{ticket.assertCurrent();if(!['turn/start','turn/steer'].includes(method))return;if(handoffHints.has(provider))throw Error('请等待当前能力交接完成；未发送或重发请求。');if(ticket.selection?.kind==='ssh-terminal')throw Error('原 SSH 终端属于旧连接格式，请明确重新登录建立独立通道。');if(ticket.selection?.kind==='ssh-connection'&&(route==='service'?!workerSelected(provider):route==='shell'?!shellGranted(provider):true))throw Error('当前操作所属的 SSH 能力授权已变化；不会改用另一能力或重新登录。');}};}
 async function readiness(provider){
  const ticket=capture();if(!ticket.selection)return null;
  if(legacy())return {status:'blocked',scope:'terminal-only',scientificStatus:'blocked',count:0,reason:'legacy_connection_requires_login',message:'旧连接记录不能替代本次认证，请明确重新登录。',checkedAt:Date.now()};
  if(!connection())return null;
  const state=await resource().status({});ticket.assertCurrent();
  if(state?.schemaVersion!==2||state.kind!=='ssh-connection'||state.selectionId!==ticket.selection.selectionId||state.connectionId!==ticket.selection.connectionId||state.profileId!==ticket.selection.profileId||state.profileVersion!==ticket.selection.profileVersion||state.status!=='selected'||state.connectionStatus!=='authenticated'||state.authentication!=='verified')return {status:'blocked',scope:'terminal-only',scientificStatus:'blocked',count:0,transport:'ssh-connection',reason:state?.reason||'selected_connection_unverified',message:'所选 SSH 连接的认证或配置已变化，请核对原连接；不会借用其他能力或重新登录。',resource:state,checkedAt:Date.now()};
  if(workerSelected(provider)){let tools;try{tools=await worker.probeTools();}catch{}ticket.assertCurrent();if(workerSelected(provider)&&['ready','warning'].includes(tools?.status))return {status:'ready',scope:'workflow',scientificStatus:tools.status,warning:tools.status==='warning',count:tools.count,transport:'ssh-connection',message:tools.status==='warning'?tools.message:'所选 SSH 作业服务已连接；具体科学环境按需配置和验证。',resource:state,checkedAt:Date.now()};}
  let shell=false;if(shellGranted(provider)){try{const list=await sharedTerminal().list({});ticket.assertCurrent();shell=list.sessions.some(s=>s.connectionId===ticket.selection.connectionId&&s.kind==='ssh'&&s.alive===true&&!s.expired&&s.owner==='agent'&&sharedTerminal().hasCurrentGrant(provider,s.sessionId));}catch{}}
  ticket.assertCurrent();const ready=shell&&shellGranted(provider);
  return {status:ready?'ready':'blocked',scope:'terminal-only',scientificStatus:'blocked',count:ready?3:0,transport:'desktop-terminal',message:ready?'所选连接的共享终端可用；服务状态不影响此独立通道。':'请在此连接的终端点击“交给 Agent”。',reason:ready?null:'current_capability_grant_required',resource:state,checkedAt:Date.now()};
 }
 function turnContext(provider){if(!workerSelected(provider))return null;return '[Studio selected compute resource]\n'+JSON.stringify({kind:'ssh-connection',status:'authenticated',service:'connected',serviceAuthorizedForThisConversation:true,shellAuthorizedForThisConversation:shellGranted(provider),schedulerRegistration:'not_checked'})+'\nThe selected SSH connection is authenticated. The human handoff enables separately verified shell and service grants. The managed service uses its own channel. When the user explicitly selects a shared-shell service transport, ordinary input resumes after its exchange is confirmed. Connection readiness does not establish installed scientific tools, a configured environment or execution readiness. Incomplete inventory and repairable environment issues are warnings: inspect and help configure within the granted terminal and project scope. list_clusters returns saved scheduler profiles, not SSH sessions. For a requested current-host queue observation call inspect_compute_resource with probe_scheduler=true, without creating a workflow or asking the human to paste commands. A missing profile does not mean disconnected. A service failure does not by itself establish shell failure; only an independently verified and granted shell can be used. Never reconnect, upgrade, switch resources or replay unknown requests automatically.';}
 return {selected,capture,providerConnection,bindWorkerContext,scope,readiness,workerSelected,turnContext,prepareHandoff,assertHandoffComplete};
}
