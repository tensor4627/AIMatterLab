import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {registerSshConnectionRoutes,validateSshConnectionRequest} from '../../backend/main/compute/ssh-connection-ipc.mjs';
import {SCIENTIFIC_TOOL_ACCESS} from '../../agent/tools/private-cv-access.mjs';

const names=['open','list','state','authRead','authInput','authResize','confirm','completeLogin','loginStatus','openShell','close'];
const body=method=>method==='open'?{profileId:'profile',profileVersion:1,requestId:'open-request'}:method==='list'?{}:method==='authInput'?{connectionId:'connection',requestId:'input-request',data:'SYNTHETIC_TEST_INPUT'}:method==='authResize'?{connectionId:'connection',cols:90,rows:30}:['openShell','completeLogin','loginStatus'].includes(method)?{connectionId:'connection',requestId:'shell-request'}:{connectionId:'connection'};
test('each new privileged route uses actual main sender validation and retains human-only authentication entry points',async()=>{
 const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),declarations=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&['handle','trusted'].includes(node.name?.text)).map(node=>node.getText(tree));
 let registration;function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='registerSshConnectionRoutes')registration=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);assert.equal(declarations.length,2);assert(registration);
 const handlers=new Map(),calls=[],events=[],service={connectionLost:id=>calls.push({method:'serviceUnknown',id}),connectionClosed:id=>calls.push({method:'serviceClosed',id})},connections=Object.fromEntries(names.map(method=>[method,async value=>{calls.push({method,value});return method==='list'?{connections:[]}:{connectionId:value.connectionId||'new-connection',...method==='close'?{status:'closed',closed:true}:{}};}]));
 const context={registerSshConnectionRoutes,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},sharedTerminal:{connections},sshService:service,
  managedResources:{revokeConnection:({connectionId:id})=>calls.push({method:'resourceRevoked',id})},conversationTerminals:{releaseConnection:id=>calls.push({method:'releaseConversation',id})},
  workspaceTerminalAuthorization:{revokeConnection:id=>calls.push({method:'workspaceRevoked',id})},
  emit:(_channel,value)=>events.push(value),shuttingDown:false,window:{isDestroyed:()=>false,webContents:{id:41,isDestroyed:()=>false,getURL:()=> 'file:///studio/index.html'}}};
 vm.runInNewContext(declarations.join('\n')+'\n'+registration,context);
 const valid={sender:{id:41,isDestroyed:()=>false},senderFrame:{parent:null,url:'file:///studio/index.html'}};
 for(const method of names){const route=handlers.get('studio:compute.sshConnection.'+method);assert(route);for(const change of [{sender:{id:42,isDestroyed:()=>false}},{senderFrame:{parent:{},url:'file:///studio/index.html'}},{senderFrame:{parent:null,url:'https://foreign.invalid'}}])await assert.rejects(route({...valid,...change},body(method)),/Untrusted IPC/);}
 assert.equal(calls.length,0);
 for(const method of names)await handlers.get('studio:compute.sshConnection.'+method)(valid,body(method));
 assert.equal(calls.filter(c=>c.method==='authInput').length,1);const close=calls.findIndex(c=>c.method==='close');assert.equal(calls[close-1].method,'serviceUnknown');assert.equal(calls[close+1].method,'serviceClosed');assert.equal(calls[close-4].method,'resourceRevoked');assert.deepEqual(calls[close-2],{method:'workspaceRevoked',id:'connection'});assert(events.some(e=>e.method==='studio/sshConnectionChanged'));
 for(const name of ['authInput','authRead','open','confirm','completeLogin','loginStatus'])assert.equal(Object.hasOwn(SCIENTIFIC_TOOL_ACCESS,'compute.sshConnection.'+name),false);
});
test('connection IPC rejects extra fields, injected identities and invalid authentication bounds before dispatch',()=>{
 for(const method of names)assert.throws(()=>validateSshConnectionRequest(method,{...body(method),command:'do-not-run'}),/invalid_request/);
 for(const method of names.filter(n=>!['open','list'].includes(n)))assert.throws(()=>validateSshConnectionRequest(method,{...body(method),connectionId:'../../other'}),/invalid_request/);
 for(const value of [{connectionId:'connection',cursor:-1},{connectionId:'connection',maxBytes:65537},{connectionId:'connection',cursor:1.5}])assert.throws(()=>validateSshConnectionRequest('authRead',value),/invalid_request/);
 for(const data of ['',null,123,'x'.repeat(8193)])assert.throws(()=>validateSshConnectionRequest('authInput',{...body('authInput'),data}),/invalid_request/);
 assert.throws(()=>validateSshConnectionRequest('open',{...body('open'),profileVersion:0}),/invalid_request/);
 assert.throws(()=>validateSshConnectionRequest('authResize',{...body('authResize'),rows:1}),/invalid_request/);
});
test('actual preload admits only the declared connection methods and no authentication wildcard',async()=>{
 let bridge;const calls=[];vm.runInNewContext(fs.readFileSync(new URL('../../desktop/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return args[1];},on(){},removeListener(){}}})});
 for(const method of names){const value=body(method);assert.equal(await bridge.invoke('compute.sshConnection.'+method,value),value);}
 for(const method of ['execute','spawn','authenticate','readKey','grantProject','reconnect'])await assert.rejects(bridge.invoke('compute.sshConnection.'+method,{}),/Unsupported/);
 assert.equal(calls.length,names.length);
});
test('a lost whole-connection close acknowledgement revokes use but retains unknown attempt evidence without retry',async()=>{
 const handlers=new Map(),effects=[];let calls=0;
 registerSshConnectionRoutes({handle:(name,fn)=>handlers.set(name,fn),connections:{close:async()=>{calls++;throw Error('unconfirmed');}},onClosing:id=>effects.push(['closing',id]),onUnknown:id=>effects.push(['unknown',id]),onClosed:id=>effects.push(['closed',id])});
 await assert.rejects(handlers.get('compute.sshConnection.close')({connectionId:'exact-owned-connection'}),/unconfirmed/);
 assert.equal(calls,1);assert.deepEqual(effects,[['closing','exact-owned-connection'],['unknown','exact-owned-connection']]);
});
