import fs from 'node:fs';
import path from 'node:path';
import {redact} from '../../../agent/providers/contracts.mjs';

// Self-contained so the exact tested observer runs inside the isolated renderer.
export function providerSentinelObserver(provider,threadId){
 const harmless=new Set(['userMessage','agentMessage','plan','reasoning','contextCompaction']);
 const types=new Set(),tools=new Map(),messages=new Map();
 return event=>{
  if(event.provider!==provider||event.params?.threadId!==threadId)return null;
  const p=event.params||{};
  if(event.method==='item/agentMessage/delta'){const id=p.itemId||'agent';messages.set(id,(messages.get(id)||'')+(p.delta||''));}
  if(['item/started','item/completed'].includes(event.method)&&p.item){
   const item=p.item,type=typeof item.type==='string'?item.type:'unknown';types.add(type);
   if(!harmless.has(type))tools.set(item.id||type,{id:item.id||null,type});
   if(event.method==='item/completed'&&type==='agentMessage'&&typeof item.text==='string')messages.set(item.id||'agent',item.text);
  }
  if(event.method!=='turn/completed')return null;
  const responseMatched=[...messages.values()].join('').trim()==='STUDIO_INSTALL_AGENT_OK';
  return {status:p.turn?.status==='completed'&&responseMatched&&tools.size===0?'passed':'failed',responseMatched,toolCalls:tools.size,itemTypes:[...types].sort(),toolItems:[...tools.values()]};
 };
}

export async function verifyProviderAccess(provider,invoke,verifyTurn,stage=()=>{}){
 stage('provider_connect');const connection=await invoke('agent.connect',{provider});
 if(connection?.cliRequired){stage('provider_cli');throw Error('Selected CLI is not ready; choose a compatible local CLI or explicitly download it in the same Studio profile');}
 stage('account_read');const account=await invoke('agent.account',{provider});
 stage('model_list');const models=await invoke('agent.rpc',{provider,method:'model/list'});
 const metadata={available:!!account.account,requiresOpenaiAuth:account.requiresOpenaiAuth??null,catalogAuthRequired:models.authRequired??null};
 if(!Array.isArray(models.data)||!models.data.length)throw Error('No callable model catalog; configure the selected provider');
 const model=models.data.find(value=>value.isDefault)?.model||models.data[0].model;
 stage('thread_start');const started=await invoke('agent.rpc',{provider,method:'thread/start',params:{model}});
 if(typeof started.thread?.id!=='string'||!started.thread.id)throw Error('Provider did not return a thread identity');
 const payload={provider,method:'turn/start',params:{planningMode:false,threadId:started.thread.id,model,input:[{type:'text',text:'Reply exactly STUDIO_INSTALL_AGENT_OK. Do not call tools or create tasks.'}]}};
 stage('provider_turn');const outcome=await verifyTurn(payload);
 return {provider,accountMetadata:metadata,modelCount:models.data.length,modelAccess:outcome.status==='passed'?'passed':outcome.status,...outcome};
}

export async function verifyDesktop(window,root,errors){
 const report={status:'blocked',scope:'Isolated profile: real desktop, worker and provider turn; no scientific jobs from this window',checks:{},errors};
 const js=code=>window.webContents.executeJavaScript(code,true);
 const invoke=(method,data={})=>js('window.studio.invoke('+JSON.stringify(method)+','+JSON.stringify(data)+')');
 let stage='renderer';
 try{
  await new Promise(r=>setTimeout(r,800));
  report.checks.renderer=await js("({node:typeof require,bridge:typeof window.studio.invoke,planningDefault:document.querySelector('[data-testid=agent-planning-mode]')?.checked})");
  if(report.checks.renderer.node!=='undefined'||report.checks.renderer.bridge!=='function'||report.checks.renderer.planningDefault!==false)throw Error('Desktop boundary or default chat failed');
  stage='worker_connect';await invoke('worker.connect');report.checks.worker={status:'passed'};
  stage='desktop_state';const state=await invoke('state'),provider=state.settings.agentProvider||'codex';
  report.checks.provider=await verifyProviderAccess(provider,invoke,async payload=>{
  const observe='('+providerSentinelObserver.toString()+')('+JSON.stringify(provider)+','+JSON.stringify(payload.params.threadId)+')';
  return await js("new Promise(async(resolve)=>{const observe="+observe+";const timer=setTimeout(()=>{off();resolve({status:'blocked',reason:'Provider timeout'});},90000);const off=window.studio.onEvent(e=>{const outcome=observe(e);if(outcome){clearTimeout(timer);off();resolve(outcome);}});try{await window.studio.invoke('agent.rpc',"+JSON.stringify(payload)+");}catch{clearTimeout(timer);off();resolve({status:'blocked',reason:'Provider invocation failed'});}})");
  },value=>{stage=value;});
  if(report.checks.provider.status!=='passed')throw Error('Provider call not verified');
  report.status='passed';
 }catch(error){report.status=report.checks.provider?.status==='failed'||stage==='renderer'?'failed':'blocked';report.failedStage=stage;report.reason='Desktop verification blocked at '+stage+'; inspect the private diagnostic and correct the selected provider or environment';fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'desktop-diagnostic.json'),JSON.stringify({stage,error:redact(String(error?.message||error))},null,2));}
 fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'desktop-install.json'),JSON.stringify(report,null,2));
 return report.status==='passed';
}
