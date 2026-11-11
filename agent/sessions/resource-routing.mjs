/** Select the Agent's existing transport from authoritative compute-resource metadata. */
export function createAgentResourceRouting({worker,terminal,resource,sharedTerminal,agents,service=()=>null}){
 const selected=()=>resource()?.peek()||null;
 function workerSelected(){const value=selected(),identity=worker.identity,target=worker.connectionTarget;return value?.kind==='ssh-terminal'&&!!worker.connection&&identity?.kind==='ssh'&&identity.profileId===value.profileId&&identity.profileVersion===value.profileVersion&&target?.sessionId===value.sessionId;}
 function selectedService(){const value=selected(),state=service()?.peek?.();return value?.kind==='ssh-terminal'&&state?.sessionId===value.sessionId&&state.profileId===value.profileId&&state.profileVersion===value.profileVersion&&state.status!=='disconnected'?state:null;}
 function capture(){const controller=resource(),ticket=controller?.capture();return {selection:ticket?.selection||null,assertCurrent:()=>{if(controller!==resource())throw Error('compute_resource_selection_changed');if(ticket)controller.assertCurrent(ticket);}};}
 function providerConnection(provider){return selected()?.kind==='ssh-terminal'?(workerSelected()?worker.providerConnection(provider):selectedService()?undefined:terminal()?.providerConnection(provider)):worker.providerConnection(provider)||terminal()?.providerConnection(provider);}
 function bindWorkerContext(provider,context,options){
  const ssh=selected()?.kind==='ssh-terminal',local=terminal()?.bindProviderContext(provider,context,options);let binding=local,terminalRoute=true;
  if(!ssh||workerSelected()||selectedService()){const scientific=worker.bindProviderContext(provider,context,options);if(worker.providerConnection(provider)){binding=scientific;terminalRoute=false;}else binding=ssh?scientific:local||scientific;}
  const previous=agents()?.bridgeWorkers?.get(provider);
  return previous&&(previous.transport==='desktop-terminal')!==terminalRoute?{...binding,rotated:true}:binding;
 }
 function scope(provider,method){const ticket=capture();return {assertCurrent:()=>{ticket.assertCurrent();if(ticket.selection?.kind==='ssh-terminal'&&['turn/start','turn/steer'].includes(method)){if(selectedService()){if(!workerSelected()||selectedService().status!=='connected')throw Error('当前 SSH 作业服务不可用，请核对原连接。');}else if(!sharedTerminal()?.hasCurrentGrant(provider,ticket.selection.sessionId))throw Error('请先将所选 SSH 终端交接给当前对话；不会改用其他计算资源。');}}};}
 async function readiness(provider){
  const ticket=capture();if(ticket.selection?.kind!=='ssh-terminal')return null;
  const state=await resource().status({});ticket.assertCurrent();
  if(workerSelected()||selectedService()){
   let tools;try{tools=workerSelected()?await worker.probeTools():null;}catch{}ticket.assertCurrent();
   const ready=workerSelected()&&selectedService()?.status==='connected'&&tools?.status==='ready';
   return {status:ready?'ready':'blocked',scope:'workflow',scientificStatus:ready?'ready':'blocked',count:ready?tools.count:0,transport:'ssh-terminal',message:ready?'SSH 作业服务已连接':'当前 SSH 作业服务不可用，请核对原连接。',resource:state,checkedAt:Date.now()};
  }
  const ready=state.selectionId===ticket.selection.selectionId&&state.status==='selected'&&state.agentReady===true&&sharedTerminal()?.hasCurrentGrant(provider,ticket.selection.sessionId)===true;
  return {status:ready?'ready':'blocked',scope:'terminal-only',scientificStatus:'blocked',count:ready?3:0,transport:'desktop-terminal',message:ready?'所选 SSH 共享终端可用':'请先将所选 SSH 终端交接给当前对话；不会改用其他计算资源。',reason:state.reason,resource:state,checkedAt:Date.now()};
 }
 return {selected,capture,providerConnection,bindWorkerContext,scope,readiness,workerSelected};
}
