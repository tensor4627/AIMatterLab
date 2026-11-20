import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../../backend/main/compute/shared-terminal.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('shared-terminal.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),node=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='localRequest');assert(node);
function transport({timeout=false,abort=false}={}){
 const calls=[],http={request(url,options,onResponse){const req=new EventEmitter();req.write=()=>{};req.end=()=>queueMicrotask(()=>{if(timeout)return req.timer();const response=new EventEmitter();response.statusCode=200;response.destroy=()=>{};onResponse(response);if(abort)return response.emit('aborted');response.emit('data',Buffer.from('{"observed":true}'));response.emit('end');});req.destroy=()=>{req.destroyed=true;};req.setTimeout=(milliseconds,callback)=>{calls.push({url,method:options.method,milliseconds});req.timer=callback;};return req;}};
 const run=new Function('http','descriptorValid','brokerRefusals','return ('+node.getText(tree)+');')(http,()=>true,new Map());return {run,calls};
}
const descriptor={origin:'http://127.0.0.1:12345',controlToken:'inert'};
for(const operation of ['input','resize','owner','close'])test('queued shared-shell '+operation+' keeps the service-exchange budget and preserves its broker on an unknown result',async()=>{const route='/sessions/owned/'+operation,f=transport();assert.deepEqual(await f.run(descriptor,'POST',route,{}),{observed:true});assert.equal(f.calls[0].milliseconds,260000);for(const failure of ['timeout','abort']){const broken=transport({[failure]:true});await assert.rejects(broken.run(descriptor,'POST',route,{}),e=>e.message==='terminal_service_unknown'&&e.terminalRejected===true);assert.equal(broken.calls.length,1);}});
test('actual main HTTP transport budgets composite login at sixty seconds and admits only bounded fixed status paths',async()=>{
 const f=transport();assert.deepEqual(await f.run(descriptor,'POST','/connections/owned/login/complete',{requestId:'login'}),{observed:true});assert.equal(f.calls[0].milliseconds,60000);
 assert.deepEqual(await f.run(descriptor,'GET','/connections/owned/login/status/login'),{observed:true});assert.equal(f.calls[1].milliseconds,5000);
 await assert.rejects(f.run(descriptor,'GET','/connections/owned/login/status/../login'),/terminal_unavailable/);await assert.rejects(f.run(descriptor,'GET','/connections/owned/login/status/'+ 'a'.repeat(101)),/terminal_unavailable/);assert.equal(f.calls.length,2);
});
for(const failure of ['timeout','abort'])test('unknown login '+failure+' is explicit and keeps the descriptor available for pure observation',async()=>{
 const f=transport({[failure]:true});await assert.rejects(f.run(descriptor,'POST','/connections/owned/login/complete',{requestId:'login'}),error=>error.message==='terminal_login_unknown'&&error.terminalRejected===true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].milliseconds,60000);
});
test('a control proof can outlast a normal status read and a missing proof does not discard its broker',async()=>{
 const route='/connections/owned/state',f=transport();
 assert.deepEqual(await f.run(descriptor,'GET',route),{observed:true});assert.equal(f.calls[0].milliseconds,15000);
 for(const [failure,code] of [['timeout','ssh_control_timeout'],['abort','ssh_control_unavailable']]){
  const unknown=transport({[failure]:true});
  await assert.rejects(unknown.run(descriptor,'GET',route),error=>error.message===code&&error.terminalRejected===true);
  assert.equal(unknown.calls.length,1);
 }
});
