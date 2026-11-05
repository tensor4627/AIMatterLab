// Actual Agent/App + typed renderer clients. Only IPC answers are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,deferred} from '../helpers/agent-hooks.mjs';
import {appWorkerHarness,completeComputeGuide} from '../helpers/app-worker-hooks.mjs';

const resource=(values={})=>({schemaVersion:1,selectionId:'selection-A',kind:'ssh-terminal',profileId:'saved-ssh',profileVersion:3,sessionId:'ssh-A',status:'selected',operator:'human',processStatus:'running',alive:true,agentReady:false,reason:null,authentication:'not_observed',managedRuns:false,...values});
const noModelOrTask=h=>assert(!h.calls.some(c=>c.method==='task.create'||c.method==='agent.rpc'&&c.data.method==='turn/start'));
const starts=h=>h.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='thread/start');
const local={id:'saved-local',version:2,kind:'wsl',name:'Existing local',distribution:'Saved Ubuntu',root:'/fixture',port:8767,intent:'existing'};

test('fresh planning SSH message establishes the ordinary conversation, retains its draft, and waits for explicit handoff before any turn',async()=>{
 const h=agentHarness({props:{planningMode:true,computeConnected:false,computeResource:resource()},override:(method,data,standard)=>method==='agent.connect'?{tools:{status:'blocked',count:0}}:standard(method,data)});await h.flush();h.click('agent-connect');await h.flush();h.type('Keep the original terminal and plan, 310 K');h.send();await h.flush();
 assert.equal(starts(h).length,1);assert.equal(h.conversations.at(-1)?.threadId,'started-thread');assert.equal(h.textarea().props.value,'Keep the original terminal and plan, 310 K');noModelOrTask(h);assert(!h.calls.some(c=>c.method.startsWith('sharedTerminal.')||c.method==='worker.connect'));assert.throws(()=>h.find(n=>n.props?.['data-testid']==='agent-tool-repair'));
 h.render({computeResource:resource({operator:'agent',agentReady:true})});h.emit({provider:'codex',method:'studio/toolsStatus',params:{status:'ready',scope:'terminal-only',count:1}});await h.flush();h.send();await h.flush();assert.equal(starts(h).length,1);assert.equal(h.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/start').length,1);assert(!h.calls.some(c=>c.method==='task.create'||c.method==='worker.connect'));assert.equal(h.textarea().props.value,'');h.unmount();
});

test('selected SSH overrides a connected managed worker for the UI gate without creating a managed task',async()=>{
 const h=agentHarness({props:{planningMode:true,computeConnected:true,computeResource:resource()},override:(method,data,standard)=>method==='agent.connect'?{tools:{status:'ready',scope:'scientific',count:12}}:standard(method,data)});await h.flush();h.click('agent-connect');await h.flush();h.type('selected SSH only');h.send();await h.flush();noModelOrTask(h);assert.equal(starts(h).length,1);assert.match(JSON.stringify(h.find(n=>n.props?.['data-testid']==='agent-ssh-resource-notice').props.children),/交给 Agent/);h.unmount();
});

test('late thread response after selecting another SSH resource cannot remember or send the old request',async()=>{
 const gate=deferred(),h=agentHarness({props:{planningMode:true,computeConnected:false,computeResource:resource()},override:(method,data,standard)=>method==='agent.rpc'&&data.method==='thread/start'?gate.promise:method==='agent.connect'?{tools:{status:'blocked',count:0}}:standard(method,data)});await h.flush();h.click('agent-connect');await h.flush();h.type('retain me');h.send();await h.flush();h.render({computeResource:resource({selectionId:'selection-B',sessionId:'ssh-B'})});gate.resolve({thread:{id:'late-A'}});await h.flush();assert(!h.calls.some(c=>c.method==='conversation.remember'));noModelOrTask(h);assert.equal(h.textarea().props.value,'retain me');h.unmount();
});

test('stale or unavailable SSH terminal does not create a thread or fabricate a successful tool scope',async()=>{
 for(const value of [resource({status:'stale'}),resource({alive:false,processStatus:'exited'})]){const h=agentHarness({props:{planningMode:true,computeResource:value}});await h.flush();h.click('agent-connect');await h.flush();h.type('unsent');h.send();await h.flush();assert.equal(starts(h).length,0);noModelOrTask(h);assert.equal(h.textarea().props.value,'unsent');h.unmount();}
});

test('App displays actual SSH resource separately from the disconnected managed worker without activation or reconnect',async()=>{
 const selected=resource(),h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?selected:['worker.status','worker.restore'].includes(method)?{status:'disconnected',checkedAt:1}:standard(method,data)});await h.flush();const agent=h.find(n=>n.type==='./Agent').props;assert.equal(agent.computeConnected,false);assert.equal(agent.computeResource.sessionId,'ssh-A');assert.match(h.text(h.find(n=>n.props?.['data-testid']==='active-ssh-resource')),/SSH 终端.*由你操作/);assert.throws(()=>h.find(n=>n.props?.className==='connect-banner'));const footer=h.text(h.find(n=>n.type==='footer'));assert.match(footer,/SSH 终端已打开.*由你操作/);assert.doesNotMatch(footer,/WSL 未连接|认证成功|已登录/);assert(!h.calls.some(c=>c.method==='compute.resource.activate'||c.method==='worker.connect'||c.method==='sharedTerminal.open'));h.unmount();
});

test('App footer reflects selected SSH Agent ownership, unknown state and exit without changing worker connectivity',async()=>{
 for(const [selected,expected]of [[resource({operator:'agent',agentReady:true}),/SSH 终端已打开.*由 Agent 操作/],[resource({processStatus:'unknown',alive:null}),/SSH 终端状态未知/],[resource({processStatus:'exited',alive:false}),/SSH 终端已退出/]]){const h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?selected:['worker.status','worker.restore'].includes(method)?{status:'disconnected',checkedAt:1}:standard(method,data)});await h.flush();assert.match(h.text(h.find(n=>n.type==='footer')),expected);assert.equal(h.find(n=>n.type==='./Agent').props.computeConnected,false);h.unmount();}
});

test('late readonly resource response cannot overwrite a newer explicitly activated terminal',async()=>{
 const gate=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?gate.promise:standard(method,data)});await h.flush();h.find(n=>n.type==='./SharedTerminalPanel').props.onResourceChange(resource(),'Saved SSH resource');await h.flush();gate.resolve({schemaVersion:1,selectionId:null,kind:null,status:'none'});await h.flush();assert.equal(h.find(n=>n.type==='./Agent').props.computeResource.sessionId,'ssh-A');assert.match(h.text(h.find(n=>n.props?.['data-testid']==='active-ssh-resource')),/Saved SSH resource/);h.unmount();
});

test('only a successfully verified local connection CAS-clears the previously selected SSH pointer and never closes its terminal',async()=>{
 for(const connected of [false,true]){let selected=resource();const h=appWorkerHarness({override:(method,data,standard)=>{if(method==='compute.resource.status')return selected;if(method==='compute.resource.clear'){assert.deepEqual(data,{selectionId:'selection-A'});selected={...selected,selectionId:null,kind:null,status:'none'};return selected;}return standard(method,data);}});await h.flush();h.find(n=>n.props?.['data-testid']==='unified-compute-entry').props.onClick();await h.flush();const work=h.find(n=>n.type==='./ComputeConnectionChooser').props.onLocal(local);await h.flush();await completeComputeGuide(h,connected);await work;await h.flush();assert.equal(h.calls.filter(c=>c.method==='compute.resource.clear').length,connected?1:0);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();}
});

test('a later SSH selection during the local guide is retained without clearing or closing either terminal',async()=>{
 let selected=resource();const h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?selected:standard(method,data)});await h.flush();h.find(n=>n.props?.['data-testid']==='unified-compute-entry').props.onClick();await h.flush();const work=h.find(n=>n.type==='./ComputeConnectionChooser').props.onLocal(local);await h.flush();selected=resource({selectionId:'selection-B',sessionId:'ssh-B'});h.find(n=>n.type==='./SharedTerminalPanel').props.onResourceChange(selected,'Later SSH');await h.flush();await completeComputeGuide(h,true);await work;await h.flush();assert(!h.calls.some(c=>c.method==='compute.resource.clear'||c.method==='sharedTerminal.close'));assert.equal(h.find(n=>n.type==='./Agent').props.computeResource.sessionId,'ssh-B');h.unmount();
});

test('late CAS-clear acknowledgement cannot replace a newer explicitly selected SSH resource',async()=>{
 const gate=deferred(),selected=resource(),h=appWorkerHarness({override:(method,data,standard)=>method==='compute.resource.status'?selected:method==='compute.resource.clear'?gate.promise:standard(method,data)});await h.flush();h.find(n=>n.props?.['data-testid']==='unified-compute-entry').props.onClick();await h.flush();const work=h.find(n=>n.type==='./ComputeConnectionChooser').props.onLocal(local);await h.flush();await completeComputeGuide(h,true);assert.equal(h.calls.filter(c=>c.method==='compute.resource.clear').length,1);h.find(n=>n.type==='./SharedTerminalPanel').props.onResourceChange(resource({selectionId:'selection-B',sessionId:'ssh-B'}));await h.flush();gate.resolve({...selected,kind:null,selectionId:null,status:'none'});await work;await h.flush();assert.equal(h.find(n=>n.type==='./Agent').props.computeResource.sessionId,'ssh-B');assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();
});
