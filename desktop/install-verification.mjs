import fs from 'node:fs';
import path from 'node:path';
export async function verifyDesktop(window,root,errors){
 const report={status:'blocked',scope:'Fresh installation profile: real desktop, worker and provider turn; no scientific jobs from this window',checks:{},errors};
 const js=code=>window.webContents.executeJavaScript(code,true);
 const invoke=(method,data={})=>js('window.studio.invoke('+JSON.stringify(method)+','+JSON.stringify(data)+')');
 try{
  await new Promise(r=>setTimeout(r,800));
  report.checks.renderer=await js("({node:typeof require,bridge:typeof window.studio.invoke,planningDefault:document.querySelector('[data-testid=agent-planning-mode]')?.checked})");
  if(report.checks.renderer.node!=='undefined'||report.checks.renderer.bridge!=='function'||report.checks.renderer.planningDefault!==false)throw Error('Desktop boundary or default chat failed');
  await invoke('worker.connect');report.checks.worker={status:'passed'};
  const state=await invoke('state'),provider=state.settings.agentProvider||'codex';
  await invoke('agent.connect',{provider});
  const account=await invoke('agent.account',{provider}),models=await invoke('agent.rpc',{provider,method:'model/list'});
  if(models.authRequired||!models.data?.length||provider==='codex'&&!account.account)throw Error('Human provider authentication required');
  const model=models.data.find(v=>v.isDefault)?.model||models.data[0].model;
  const started=await invoke('agent.rpc',{provider,method:'thread/start',params:{model}});
  const payload={provider,method:'turn/start',params:{planningMode:false,threadId:started.thread.id,model,input:[{type:'text',text:'Reply exactly STUDIO_INSTALL_AGENT_OK. Do not call tools or create tasks.'}]}};
  const outcome=await js("new Promise(async(resolve)=>{let text='',tools=0;const timer=setTimeout(()=>{off();resolve({status:'blocked',reason:'Provider timeout'});},90000);const off=window.studio.onEvent(e=>{if(e.provider!=="+JSON.stringify(provider)+"||e.params?.threadId!=="+JSON.stringify(started.thread.id)+")return;if(e.method==='item/agentMessage/delta')text+=e.params.delta||'';if(e.method==='item/started'&&e.params.item?.type==='mcpToolCall')tools++;if(e.method==='turn/completed'){clearTimeout(timer);off();resolve({status:e.params.turn.status==='completed'&&text.includes('STUDIO_INSTALL_AGENT_OK')&&tools===0?'passed':'failed',toolCalls:tools});}});try{await window.studio.invoke('agent.rpc',"+JSON.stringify(payload)+");}catch{clearTimeout(timer);off();resolve({status:'blocked',reason:'Provider invocation failed'});}})");
  report.checks.provider={provider,...outcome};
  if(outcome.status!=='passed')throw Error('Provider call not verified');
  report.status='passed';
 }catch{report.reason='Complete compatible provider login or correct desktop/worker setup, then rerun verification';}
 fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'desktop-install.json'),JSON.stringify(report,null,2));
 return report.status==='passed';
}
