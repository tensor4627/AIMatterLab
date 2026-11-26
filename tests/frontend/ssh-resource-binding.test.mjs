// Actual Agent/App + typed renderer clients. Only IPC answers are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,deferred} from '../helpers/agent-hooks.mjs';
import {appWorkerHarness,completeComputeGuide} from '../helpers/app-worker-hooks.mjs';
import {requestsComputeName} from '../../backend/main/compute/managed-compute-intent.mjs';

const resource=(values={})=>({schemaVersion:2,selectionId:'selection-A',kind:'ssh-connection',connectionId:'connection-A',profileId:'saved-ssh',profileVersion:3,sessionId:null,terminalSessionIds:[],status:'selected',connectionStatus:'authenticated',operator:'human',processStatus:'running',alive:true,agentReady:false,reason:null,authentication:'verified',managedRuns:false,workflowReady:false,capabilities:{terminal:{status:'closed',sessionIds:[],agentReady:false,operator:'human'},service:{status:'disconnected',agentReady:false,operator:'human',workflowReady:false},files:{status:'unavailable',via:null}},...values});
const serviceGranted=()=>resource({workflowReady:true,managedRuns:true,serviceActive:true,serviceStatus:'connected',operator:'agent',agentReady:true,capabilities:{...resource().capabilities,service:{status:'connected',agentReady:true,operator:'agent',workflowReady:true}}});
const shellGranted=()=>resource({terminalSessionIds:['shell-A'],operator:'agent',agentReady:true,capabilities:{...resource().capabilities,terminal:{status:'ready',sessionIds:['shell-A'],agentReady:true,operator:'agent'}}});
const noModelOrTask=h=>assert(!h.calls.some(c=>c.method==='task.create'||c.method==='agent.rpc'&&c.data.method==='turn/start'));
const starts=h=>h.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='thread/start');
const local={id:'saved-local',version:2,kind:'wsl',name:'Existing local',distribution:'Saved Ubuntu',root:'/fixture',port:8767,intent:'existing'};

test('verified independent SSH service grant creates the real task before the model turn without raw handoff',async()=>{
 const verified=serviceGranted(),h=agentHarness({props:{planningMode:true,computeConnected:true,computeResource:verified},override:(method,data,standard)=>method==='agent.connect'?{tools:{status:'ready',scope:'workflow',count:20}}:method==='task.create'?{id:'ssh-flow'}:standard(method,data)});await h.flush();h.click('agent-connect');await h.flush();h.type('Prepare the selected SSH workflow');h.send();await h.flush();const calls=h.calls;assert.equal(calls.filter(call=>call.method==='task.create').length,1);assert.equal(calls.filter(call=>call.method==='sharedTerminal.owner').length,0);const turn=calls.find(call=>call.method==='agent.rpc'&&call.data.method==='turn/start');assert.equal(turn.data.params.studioTaskId,'ssh-flow');assert(calls.findIndex(call=>call.method==='task.create')<calls.indexOf(turn));h.unmount();
});

test('a claimed workflow flag without verified service identity or with stale terminal tools cannot create a task',async()=>{
 for(const values of [{workflowReady:true},{workflowReady:true,managedRuns:true,authentication:'verified'}]){const h=agentHarness({props:{planningMode:true,computeResource:resource(values)},override:(m,d,s)=>m==='agent.connect'?{tools:{status:'ready',scope:'terminal-only',count:3}}:s(m,d)});await h.flush();h.click('agent-connect');await h.flush();h.type('Do not promote a shell');h.send();await h.flush();noModelOrTask(h);h.unmount();}
});

test('an ungranted SSH draft waits for explicit handoff before creating a conversation or turn',async()=>{
 const h=agentHarness({props:{planningMode:true,computeConnected:false,computeResource:resource()},override:(method,data,standard)=>method==='agent.connect'?{tools:{status:'blocked',count:0}}:standard(method,data)});await h.flush();h.click('agent-connect');await h.flush();h.type('Keep the original terminal and plan, 310 K');h.send();await h.flush();
 assert.equal(starts(h).length,0);assert.equal(h.conversations.length,0);assert.equal(h.textarea().props.value,'Keep the original terminal and plan, 310 K');noModelOrTask(h);assert(!h.calls.some(c=>c.method.startsWith('sharedTerminal.')||c.method==='worker.connect'));assert.throws(()=>h.find(n=>n.props?.['data-testid']==='agent-tool-repair'));
 h.render({computeResource:shellGranted()});h.emit({provider:'codex',method:'studio/toolsStatus',params:{status:'ready',scope:'terminal-only',count:1}});await h.flush();h.send();await h.flush();assert.equal(starts(h).length,1);assert.equal(h.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/start').length,1);assert(!h.calls.some(c=>c.method==='task.create'||c.method==='worker.connect'));assert.equal(h.textarea().props.value,'');h.unmount();
});

test('managed chat sends without preparing a legacy SSH terminal when both resource controls are present',async()=>{
 const h=agentHarness({props:{planningMode:false,computeConnected:false,computeResource:resource({canAcquireConversationTerminal:true})},
  override:(method,data,standard)=>method==='agent.connect'?{tools:{status:'ready',scope:'chat',count:12,managedCompute:true}}:standard(method,data)});
 await h.flush();
 h.click('agent-connect');
 await h.flush();
 const before=h.calls.length;
 h.type('请使用「测试集群」检查 Python 环境');
 h.send();
 await h.flush();
 const calls=h.calls.slice(before);
 assert(calls.some(call=>call.method==='agent.rpc'&&call.data.method==='turn/start'));
 assert(!calls.some(call=>['compute.resource.status','sharedTerminal.owner','worker.connect','task.create'].includes(call.method)));
 assert.throws(()=>h.find(node=>node.props?.['data-testid']==='agent-ssh-resource-notice'));
 h.unmount();
});

for(const language of ['zh-CN','en'])test('SSH environment help selects the setup guide for the submitted draft in '+language,async()=>{
 const h=appWorkerHarness({override:async(method,data,standard)=>{
  const result=await standard(method,data);
  return method==='state'?{...result,settings:{...result.settings,language}}:result;
 }});
 await h.flush();
 h.find(node=>node.props?.['data-testid']==='unified-compute-entry').props.onClick();
 await h.flush();
 const profile={id:'saved-ssh',version:3,name:'测试集群',host:'private-host',username:'private-user',
  serviceEnvironment:{python:'private-interpreter'}};
 const before=h.calls.length;
 h.find(node=>node.type==='./ComputeConnectionChooser').props.onServiceEnvironmentHelp(profile);
 await h.flush();
 const {intent}=h.find(node=>node.type==='./Agent').props;
 assert.equal(intent.autoSend,undefined);
 assert(requestsComputeName(intent.text.normalize('NFKC').toLowerCase(),profile.name));
 assert.match(intent.text,/saved-ssh.*(?:版本 3|version 3)/);
 assert.match(intent.text,/list_compute_resources.*(?:一个选择参数|one selector).*acquire_compute_resource/);
 assert.match(intent.text,/已有人工共享时|already a manual share/);
 assert.match(intent.text,/cluster\.connection-setup.*environment\.probe/);
 assert.equal(intent.skill.functionId,'cluster.connection-setup');
 assert.doesNotMatch(intent.text,/交给 Agent|private-host|private-user|private-interpreter/);
 assert(!h.calls.slice(before).some(call=>call.method==='agent.rpc'||call.method.startsWith('sharedTerminal.')));
 const agent=agentHarness({props:{onAttachmentSelect:value=>agent.render({skill:value}),onAttachmentConsumed:()=>agent.render({skill:undefined})}});
 try{
  await agent.flush();agent.click('agent-connect');await agent.flush();
  agent.render({intent});await agent.flush();
  assert.equal(agent.textarea().props.value,intent.text);
  noModelOrTask(agent);
  agent.send();await agent.flush();
  const turn=agent.calls.find(call=>call.data?.method==='turn/start');
  assert.equal(turn.data.params.studioSkillId,'cluster.connection-setup');
  assert.equal(turn.data.params.input[0].text,intent.text);
  assert.throws(()=>agent.find(node=>node.props?.className==='skill-chip'),/not found/);
 }finally{agent.unmount();h.unmount();}
});

test('saving a repaired Python configuration follows the verified original SSH connection and shell',async()=>{
 const profile={kind:'ssh',id:'repair',version:2,name:'Repair fixture',mode:'key'},reads=[];
 const h=appWorkerHarness({override:(method,data,standard)=>{
  if(method==='compute.sshConnection.state'){reads.push(data);return {schemaVersion:2,connectionId:data.connectionId,profileId:profile.id,profileVersion:3,status:'authenticated',authentication:'verified',capabilities:{multiplex:true},terminalSessionIds:['original-shell'],serviceIds:[],revision:4};}
  return standard(method,data);
 }});
 try{
  await h.flush();h.find(node=>node.props?.['data-testid']==='unified-compute-entry').props.onClick();await h.flush();
  h.find(node=>node.type==='./ComputeConnectionChooser').props.onSsh(profile);await h.flush();
  const terminal=()=>h.find(node=>node.type==='./SharedTerminalPanel').props;
  terminal().onConfigureSsh({profileId:profile.id,profileVersion:2,section:'environment'},'original-connection','original-shell');await h.flush();
  h.find(node=>node.type==='./ComputeConnectionChooser').props.onProfileSaved({...profile,version:3},2);await h.flush();
  assert.deepEqual(reads,[{connectionId:'original-connection'}]);
  assert.deepEqual({connection:terminal().request.connectionId,shell:terminal().request.sessionId,version:terminal().request.version,exact:terminal().request.exact},{connection:'original-connection',shell:'original-shell',version:3,exact:true});
  assert(!h.calls.some(call=>['compute.sshConnection.open','compute.managed.publish','compute.managed.configureService'].includes(call.method)));
 }finally{h.unmount();}
});

test('selected SSH overrides a connected managed worker for the UI gate without creating a managed task',async()=>{
 const h=agentHarness({props:{planningMode:true,computeConnected:true,computeResource:resource()},override:(method,data,standard)=>method==='agent.connect'?{tools:{status:'ready',scope:'workflow',count:12}}:standard(method,data)});await h.flush();h.click('agent-connect');await h.flush();h.type('selected SSH only');h.send();await h.flush();noModelOrTask(h);assert.equal(starts(h).length,0);assert.match(JSON.stringify(h.find(n=>n.props?.['data-testid']==='agent-ssh-resource-notice').props.children),/终端.*交给 Agent|作业服务/);h.unmount();
});

test('late thread response after selecting another SSH resource cannot remember or send the old request',async()=>{
 const gate=deferred(),h=agentHarness({props:{planningMode:true,computeConnected:false,computeResource:shellGranted()},override:(method,data,standard)=>method==='agent.rpc'&&data.method==='thread/start'?gate.promise:method==='agent.connect'?{tools:{status:'ready',scope:'terminal-only',count:3}}:standard(method,data)});await h.flush();h.click('agent-connect');await h.flush();h.type('retain me');h.send();await h.flush();h.render({computeResource:resource({selectionId:'selection-B',connectionId:'connection-B'})});gate.resolve({thread:{id:'late-A'}});await h.flush();assert(!h.calls.some(c=>c.method==='conversation.remember'));noModelOrTask(h);assert.equal(h.textarea().props.value,'retain me');h.unmount();
});

test('stale or unavailable SSH terminal does not create a thread or fabricate a successful tool scope',async()=>{
 for(const value of [resource({status:'stale'}),resource({alive:false,processStatus:'exited'})]){const h=agentHarness({props:{planningMode:true,computeResource:value}});await h.flush();h.click('agent-connect');await h.flush();h.type('unsent');h.send();await h.flush();assert.equal(starts(h).length,0);noModelOrTask(h);assert.equal(h.textarea().props.value,'unsent');h.unmount();}
});

test('App displays actual SSH resource separately from the disconnected managed worker without activation or reconnect',async()=>{
 const selected=resource(),h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?selected:['worker.status','worker.restore'].includes(method)?{status:'disconnected',checkedAt:1}:standard(method,data)});await h.flush();const agent=h.find(n=>n.type==='./Agent').props;assert.equal(agent.computeConnected,false);assert.equal(agent.computeResource.connectionId,'connection-A');assert.match(h.text(h.find(n=>n.props?.['data-testid']==='active-ssh-resource')),/SSH.*已连接.*终端.*已关闭.*作业服务.*未连接/);assert.throws(()=>h.find(n=>n.props?.className==='connect-banner'));const footer=h.text(h.find(n=>n.type==='footer'));assert.match(footer,/SSH.*已连接.*终端/);assert.doesNotMatch(footer,/WSL 未连接|认证成功|已登录/);assert(!h.calls.some(c=>c.method==='compute.resource.activate'||c.method==='worker.connect'||c.method==='sharedTerminal.open'));h.unmount();
});

test('App footer reflects selected SSH Agent ownership, unknown state and exit without changing worker connectivity',async()=>{
 for(const [selected,expected]of [[serviceGranted(),/作业服务.*已连接/],[resource({connectionStatus:'unavailable',authentication:'lost',alive:false}),/SSH.*不可用/],[resource({connectionStatus:'closed',authentication:'lost',alive:false}),/SSH.*已关闭/]]){const h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?selected:['worker.status','worker.restore'].includes(method)?{status:'disconnected',checkedAt:1}:standard(method,data)});await h.flush();assert.match(h.text(h.find(n=>n.type==='footer')),expected);assert.equal(h.find(n=>n.type==='./Agent').props.computeConnected,false);h.unmount();}
});

test('the hosted SSH footer reports a pending verification instead of cached service availability',async()=>{
 const pending={kind:'ssh',resourceId:'ssh:pending',connectionId:'connection-pending',name:'Research',verificationPending:true,serviceStatus:'ready',serviceReady:false};
 const other={kind:'ssh',resourceId:'ssh:other',connectionId:'connection-other',name:'Reference',serviceStatus:'ready',serviceReady:true};
 const previous=resource({status:'unavailable',connectionStatus:undefined,authentication:'not_observed',alive:null});
 for(const rows of [[pending],[pending,other]]){
  const h=appWorkerHarness({managedResources:rows,override:(method,data,standard)=>method==='compute.resource.status'?previous:standard(method,data)});
  try{
   await h.flush();
   const footer=h.text(h.find(node=>node.props?.['data-testid']==='current-compute-resource-status'));
   assert.match(footer,/Research.*待核对/);
   assert.doesNotMatch(footer,/作业服务\s*可用/);
   if(rows.length===2)assert(footer.includes('Reference'));
  }finally{h.unmount();}
 }
});

test('reopening a saved SSH profile displays its hosted replacement while run records keep their original identity',async()=>{
 const previous=resource({status:'unavailable',connectionStatus:undefined,authentication:'not_observed',alive:null});
 const hosted={kind:'ssh',profileId:previous.profileId,profileVersion:3,connectionId:'current-desktop',name:'Campus',serviceStatus:'idle'};
 const profile={id:hosted.profileId,version:3,name:'Campus',kind:'ssh',mode:'interactive'};
 for(const rows of [[hosted],[{...hosted,profileId:'other',name:'Other'}],[]]){
  const h=appWorkerHarness({managedResources:rows,override:(method,data,standard)=>method==='compute.resource.status'?previous:standard(method,data)});
  try{
   await h.flush();
   h.find(node=>node.props?.['data-testid']==='unified-compute-entry').props.onClick();await h.flush();
   h.find(node=>node.type==='./ComputeConnectionChooser').props.onSsh(profile);await h.flush();
   const request=h.find(node=>node.type==='./SharedTerminalPanel').props.request;
   assert.equal(request.connectionId,rows.some(row=>row.profileId===profile.id)?hosted.connectionId:undefined);
   const footer=h.text(h.find(node=>node.props?.['data-testid']==='current-compute-resource-status'));
   if(rows.length)assert(footer.includes(rows[0].name)&&footer.includes('已托管'));
   else assert.match(footer,/上次选择的 SSH 连接已不可用/);
   assert.equal(h.find(node=>node.type==='./Agent').props.computeResource.connectionId,previous.connectionId);
   assert(!h.calls.some(call=>['compute.resource.activate','compute.resource.clear','compute.sshConnection.open'].includes(call.method)));
  }finally{h.unmount();}
 }
});

test('late readonly resource response cannot overwrite a newer explicitly activated terminal',async()=>{
 const gate=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?gate.promise:standard(method,data)});await h.flush();await openTerminalTab(h);h.find(n=>n.type==='./SharedTerminalPanel').props.onResourceChange(resource(),'Saved SSH resource');await h.flush();gate.resolve({schemaVersion:1,selectionId:null,kind:null,status:'none'});await h.flush();assert.equal(h.find(n=>n.type==='./Agent').props.computeResource.connectionId,'connection-A');assert.match(h.text(h.find(n=>n.props?.['data-testid']==='active-ssh-resource')),/SSH.*已连接/);h.unmount();
});

async function openTerminalTab(h) {
 const tab=h.find(node=>node.type==='button'&&h.text(node)==='终端');
 tab.props.onClick();
 await h.flush();
}

const cleared=()=>({...resource(),selectionId:null,connectionId:null,kind:null,status:'none'});
async function chooseLocal(h){h.find(n=>n.props?.['data-testid']==='unified-compute-entry').props.onClick();await h.flush();const work=h.find(n=>n.type==='./ComputeConnectionChooser').props.onLocal(local);await h.flush();return {work};}
test('explicit local selection clears SSH routing before its guide whether the guide succeeds or is cancelled',async()=>{
 for(const connected of [false,true]){let selected=resource();const h=appWorkerHarness({override:(method,data,standard)=>{if(method==='compute.resource.status')return selected;if(method==='compute.resource.clear'){assert.deepEqual(data,{selectionId:'selection-A'});selected=cleared();return selected;}return standard(method,data);}});try{await h.flush();const {work}=await chooseLocal(h);assert.equal(h.calls.filter(c=>c.method==='compute.resource.clear').length,1);assert(h.find(n=>n.type==='./ComputeConnectionGuide'));await completeComputeGuide(h,connected);await work;await h.flush();assert.equal(h.calls.filter(c=>c.method==='compute.resource.clear').length,1);assert(!h.calls.some(c=>['sharedTerminal.close','compute.sshConnection.close','compute.sshService.disconnect'].includes(c.method)));}finally{h.unmount();}}
});
test('a later SSH selection during the local guide remains selected and stops the old local continuation',async()=>{
 let selected=resource();const h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?selected:method==='compute.resource.clear'?(selected=cleared()):standard(method,data)});try{await h.flush();await openTerminalTab(h);const {work}=await chooseLocal(h);selected=resource({selectionId:'selection-B',connectionId:'connection-B'});h.find(n=>n.type==='./SharedTerminalPanel').props.onResourceChange(selected,'Later SSH');await h.flush();const before=h.calls.length;await completeComputeGuide(h,true);await work;await h.flush();assert(!h.calls.slice(before).some(c=>['state','worker.status','worker.restore','compute.resource.clear'].includes(c.method)));assert.deepEqual(h.calls.filter(c=>c.method==='compute.resource.clear').map(c=>c.data),[{selectionId:'selection-A'}]);assert.equal(h.find(n=>n.type==='./Agent').props.computeResource.connectionId,'connection-B');assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));}finally{h.unmount();}
});
test('late explicit clear acknowledgement cannot replace a newer SSH selection or open the old local guide',async()=>{
 const gate=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?resource():method==='compute.resource.clear'?gate.promise:standard(method,data)});try{await h.flush();await openTerminalTab(h);const {work}=await chooseLocal(h);assert.equal(h.calls.filter(c=>c.method==='compute.resource.clear').length,1);assert.throws(()=>h.find(n=>n.type==='./ComputeConnectionGuide'));h.find(n=>n.type==='./SharedTerminalPanel').props.onResourceChange(resource({selectionId:'selection-B',connectionId:'connection-B'}));await h.flush();gate.resolve(cleared());await work;await h.flush();assert.equal(h.find(n=>n.type==='./Agent').props.computeResource.connectionId,'connection-B');assert.throws(()=>h.find(n=>n.type==='./ComputeConnectionGuide'));assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));}finally{h.unmount();}
});
test('late initial status cannot clear a newer explicitly selected SSH connection',async()=>{
 const gate=deferred();let reads=0;const h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?(++reads===1?resource():gate.promise):standard(method,data)});try{await h.flush();await openTerminalTab(h);const {work}=await chooseLocal(h);h.find(n=>n.type==='./SharedTerminalPanel').props.onResourceChange(resource({selectionId:'selection-B',connectionId:'connection-B'}));await h.flush();gate.resolve(resource());await work;await h.flush();assert(!h.calls.some(c=>c.method==='compute.resource.clear'));assert.equal(h.find(n=>n.type==='./Agent').props.computeResource.connectionId,'connection-B');assert.throws(()=>h.find(n=>n.type==='./ComputeConnectionGuide'));}finally{h.unmount();}
});
test('refused or malformed clear acknowledgement does not open a local guide or close a background channel',async()=>{
 for(const response of ['reject','malformed']){const h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?resource():method==='compute.resource.clear'?(response==='reject'?Promise.reject(Error('inert CAS conflict')):resource()):standard(method,data)});try{await h.flush();const {work}=await chooseLocal(h);await work;await h.flush();assert.throws(()=>h.find(n=>n.type==='./ComputeConnectionGuide'));assert(!h.calls.some(c=>['sharedTerminal.close','compute.sshConnection.close','compute.sshService.disconnect'].includes(c.method)));}finally{h.unmount();}}
});

test('dead or unavailable SSH resource selection is cleared cleanly before opening the local WSL connection guide',async()=>{
 const deadSsh={schemaVersion:2,selectionId:'dead-ssh',kind:'ssh-connection',connectionId:'dead-conn',profileId:'profile',profileVersion:1,status:'selected',alive:false,authentication:'lost',agentReady:false};
 const cleared={schemaVersion:1,selectionId:null,kind:null,profileId:null,profileVersion:null,sessionId:null,status:'none',operator:'unknown',processStatus:'unknown',alive:null,agentReady:false,reason:null,authentication:'not_observed',managedRuns:false};
 const h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?deadSsh:method==='compute.resource.clear'?cleared:standard(method,data)});
 try{
  await h.flush();
  h.connect();
  await h.flush();
  assert(h.calls.some(c=>c.method==='compute.resource.clear'&&c.data?.selectionId==='dead-ssh'));
  assert(h.find(n=>n.type==='./ComputeConnectionGuide'));
 }finally{h.unmount();}
});
