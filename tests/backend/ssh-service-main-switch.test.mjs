import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {connectionServiceFixture} from '../helpers/ssh-connection-service-fixture.mjs';
import {McpProviderScopes} from '../../agent/tools/provider-scope.mjs';
const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function callback(route){let found;function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='handle'&&node.arguments[0]?.text===route)found=node.arguments[1].getText(tree);ts.forEachChild(node,visit);}visit(tree);assert(found,'actual main handler '+route);return found;}
function resourceRegistrations(){let found;function visit(node){if(ts.isForOfStatement(node)&&node.getText(tree).includes("handle('compute.resource.'+method"))found=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);assert(found,'actual main resource switch registration');return found;}
function findIdleGuard(node){
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='assertLegacyWorkerIdle')return node;
 return ts.forEachChild(node,findIdleGuard);
}
const idleGuard=findIdleGuard(tree);assert(idleGuard,'actual workbench worker idle guard');
function mount(route,{selected,service,worker,serviceStatus='connected',usesLegacyWorker=false}={}){
 const calls=[],handlers=new Map();let selection=selected,revision=1;
 const peer={provider:'kimi',threadId:'parallel-chat',busy:true,sessionId:'peer-session'};
 const scopes=new McpProviderScopes(),gateway={url:'http://127.0.0.1:43210',tokens:{mcp:'synthetic-gateway'},transport:'desktop-terminal'};
 scopes.bind(gateway);scopes.bindContext(peer.provider,{threadId:peer.threadId},{sessionId:peer.sessionId});
 const lease=scopes.connection(peer.provider,gateway,peer.sessionId);
 const peerScope=()=>scopes.authenticate({pathname:new URL(lease.url).pathname+'/mcp',host:new URL(lease.url).host,authorization:'Bearer '+lease.tokens.mcp});
 const computeResource={peek:()=>selection,capture:()=>({revision,selection:structuredClone(selection)}),clear:({selectionId})=>{assert.equal(selectionId,selection.selectionId);calls.push('explicit-clear');selection=null;revision++;return {status:'none'};}};
 const ports={
  computeResource,
  sshService:service||{peek:()=>({status:serviceStatus}),resourceChanged:async()=>calls.push('resource-changed'),disconnect:()=>assert.fail('Resource selection cannot stop SSH')},
  computeConnection:{connect:async()=>{calls.push('connect-profile');return 'profile';}},
  agents:{active:'codex',turnStates:()=>{calls.push('idle');return [peer];},sessionIdentity:(provider,threadId)=>{
   assert.equal(provider,peer.provider);assert.equal(threadId,peer.threadId);return {id:peer.sessionId};
  },assertContextIdle:()=>assert.fail('An unrelated active reply cannot block a worker switch'),close:()=>assert.fail('An unrelated active reply must survive a worker switch')},
  resourceRouting:{usesForegroundWorker:id=>{assert.equal(id,peer.sessionId);return usesLegacyWorker;}},
  conversationTerminals:{detachConnection:connectionId=>calls.push(['detach',connectionId])},
  terminalMcp:{revokeProvider:(provider,sessionId)=>scopes.revoke(provider,sessionId)},scientificTools:async()=>({status:'blocked'}),
  settings:{distribution:'owned'},worker:worker||{revokeProvider:()=>{},connect:async()=>{calls.push('connect-worker');return 'worker';}},
  workerSource:'/owned',explicitWorkerReceipt:()=>({}),bindSources:async()=>calls.push('bind-sources'),rememberExplicitWorker:async()=>calls.push('remember'),
  catalog:{},discoverCompute:()=>calls.push('discover'),managedWorkbench:{publishLocal:async active=>{assert.equal(active,ports.worker);calls.push('publish-local');}},
  emit:()=>calls.push('emit'),handle:(name,handler)=>handlers.set(name,handler)
 };
 if(worker){worker.connect=async()=>{calls.push('connect-worker');return 'worker';};}
 const run=new Function(...Object.keys(ports),idleGuard.getText(tree)+'\n'+resourceRegistrations()+'\nreturn ('+callback(route)+');')(...Object.values(ports));
 return {calls,run,peerScope,selection:()=>selection,clear:()=>handlers.get('compute.resource.clear')({selectionId:selection.selectionId})};
}
for(const route of ['compute.connection.connect','worker.connect'])for(const state of ['connected','unknown','legacy'])test('actual '+route+' requires explicit resource clear for selected '+state+' SSH and never stops it',async()=>{
 const selected=state==='legacy'?{schemaVersion:1,kind:'ssh-terminal',sessionId:'legacy',selectionId:'selected'}:{schemaVersion:2,kind:'ssh-connection',connectionId:'owned',selectionId:'selected'},f=mount(route,{selected,serviceStatus:state});await assert.rejects(f.run({}),/明确选择本地计算资源.*后台 SSH 通道会保留/);assert.deepEqual(f.calls,['idle']);assert.equal(f.selection(),selected);
});
for(const route of ['compute.connection.connect','worker.connect'])test('actual '+route+' after actual explicit clear revokes only the local SSH proxy and retains remote channels and registration',async t=>{
 const remote=connectionServiceFixture(t);await remote.connect();remote.grant();const background=remote.channels.get('A'),before=structuredClone(background),proxy=remote.worker.connection,resourceChanged=remote.service.resourceChanged.bind(remote.service),calls=[];remote.service.resourceChanged=async()=>{calls.push('resource-changed');return resourceChanged();};const selected={schemaVersion:2,kind:'ssh-connection',connectionId:'A',profileId:'profile-A',profileVersion:1,selectionId:'selected'},f=mount(route,{selected,service:remote.service,worker:remote.worker});remote.resource.peek=()=>f.selection();
 const peer=f.peerScope();assert(peer);
 await f.clear();assert.equal(f.selection(),null);assert.equal(remote.worker.connection,null);assert(proxy);assert.equal(remote.service.hasCurrentGrant('codex'),false);assert.equal(remote.service.peek({connectionId:'A'}).status,'connected');assert.equal(remote.service.peek({connectionId:'A'}).workflowReady,false);assert.equal(remote.channels.get('A'),background);assert.deepEqual(background,before);assert.equal(remote.bases.get('A').status,'authenticated');assert.equal(remote.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');assert.equal(remote.calls.filter(v=>v.close).length,0);
 assert.deepEqual(f.calls.filter(Array.isArray),[['detach','A']]);
 assert.equal(await f.run({}),route==='worker.connect'?'worker':'profile');assert.equal(calls.length,2);assert(f.calls.includes(route==='worker.connect'?'connect-worker':'connect-profile'));assert.equal(remote.calls.filter(v=>v.open).length,1);assert.equal(remote.calls.filter(v=>v.close).length,0);assert.equal(remote.channels.get('A').status,'connected');
 assert.equal(peer.checkCurrent(),true);assert.equal(f.peerScope().sessionId,peer.sessionId);
});

test('the actual switch guard refuses to detach a worker while its pinned conversation is busy',async()=>{
 const selected={schemaVersion:2,kind:'ssh-connection',connectionId:'owned',selectionId:'selected'};
 const f=mount('worker.connect',{selected,usesLegacyWorker:true});
 await assert.rejects(f.clear(),/active conversation.*workbench worker/);
 await assert.rejects(f.run({}),/active conversation.*workbench worker/);
 assert.equal(f.selection(),selected);assert.deepEqual(f.calls,['idle','idle']);
});
