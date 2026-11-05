/** Select the Agent's existing transport from authoritative compute-resource metadata. */
export function createAgentResourceRouting({worker,terminal,resource,sharedTerminal,agents}){
 const selected=()=>resource()?.peek()||null;
 function capture(){const controller=resource(),ticket=controller?.capture();return {selection:ticket?.selection||null,assertCurrent:()=>{if(controller!==resource())throw Error('compute_resource_selection_changed');if(ticket)controller.assertCurrent(ticket);}};}
 function providerConnection(provider){return selected()?.kind==='ssh-terminal'?terminal()?.providerConnection(provider):worker.providerConnection(provider)||terminal()?.providerConnection(provider);}
 function bindWorkerContext(provider,context,options){
  const ssh=selected()?.kind==='ssh-terminal',local=terminal()?.bindProviderContext(provider,context,options);let binding=local,terminalRoute=true;
  if(!ssh){const scientific=worker.bindProviderContext(provider,context,options);if(worker.providerConnection(provider)){binding=scientific;terminalRoute=false;}else binding=local||scientific;}
  const previous=agents()?.bridgeWorkers?.get(provider);
  return previous&&(previous.transport==='desktop-terminal')!==terminalRoute?{...binding,rotated:true}:binding;
 }
 function scope(provider,method){const ticket=capture();return {assertCurrent:()=>{ticket.assertCurrent();if(ticket.selection?.kind==='ssh-terminal'&&['turn/start','turn/steer'].includes(method)&&!sharedTerminal()?.hasCurrentGrant(provider,ticket.selection.sessionId))throw Error('请先将所选 SSH 终端交接给当前对话；不会改用其他计算资源。');}};}
 async function readiness(provider){
  const ticket=capture();if(ticket.selection?.kind!=='ssh-terminal')return null;
  const state=await resource().status({});ticket.assertCurrent();
  const ready=state.selectionId===ticket.selection.selectionId&&state.status==='selected'&&state.agentReady===true&&sharedTerminal()?.hasCurrentGrant(provider,ticket.selection.sessionId)===true;
  return {status:ready?'ready':'blocked',scope:'terminal-only',scientificStatus:'blocked',count:ready?3:0,transport:'desktop-terminal',message:ready?'所选 SSH 共享终端可用':'请先将所选 SSH 终端交接给当前对话；不会改用其他计算资源。',reason:state.reason,resource:state,checkedAt:Date.now()};
 }
 return {selected,capture,providerConnection,bindWorkerContext,scope,readiness};
}
