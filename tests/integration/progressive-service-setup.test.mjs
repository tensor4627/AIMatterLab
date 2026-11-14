import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionServiceFixture} from '../helpers/ssh-connection-service-fixture.mjs';

test('incomplete remote inventory keeps verified service and grants available, persists cache identity, and refreshes later',async t=>{
 const f=connectionServiceFixture(t),original=f.connections.serviceRequest;let unavailable=true;
 f.connections.serviceRequest=async packet=>packet.data?.method==='tools/list'&&unavailable?{status:200,data:{jsonrpc:'2.0',id:packet.data.id,error:{code:-32603,message:'catalog not configured'}}}:original(packet);
 f.worker.setLocalTools([{name:'list_shared_terminals'}],async()=>({sessions:[]}));
 const connected=await f.connect();assert.equal(connected.status,'connected');assert.equal(connected.workflowReady,true);assert.deepEqual(connected.warnings,['tools_unavailable']);assert.equal(connected.tools.count,1);
 f.grant();assert.equal(f.service.hasCurrentGrant('codex'),true);
 const saved=f.registration.read({profileId:'profile-A',profileVersion:1});assert.equal(saved.status,'configured');assert.deepEqual(saved.registration.toolWarnings,['tools_unavailable']);
 const endpoint=f.worker.providerConnection('codex'),send=async(method,params)=>fetch(endpoint.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+endpoint.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...params?{params}:{}})});
 const before=f.calls.length;assert.equal((await(await send('initialize')).json()).result.serverInfo.name,'gpu-sampling-studio');
 const list=await(await send('tools/list')).json();assert.deepEqual(list.result.tools.map(t=>t.name),['list_shared_terminals']);assert.deepEqual(list.result._meta.studioWarnings,['tools_unavailable']);assert.equal(f.calls.length,before);
 assert.equal((await send('tools/call',{name:'list_shared_terminals',arguments:{}})).status,200);
 unavailable=false;assert.equal((await f.service.check({connectionId:'A',attemptId:connected.attemptId})).workflowReady,true);assert.equal(f.service.peek().warnings,undefined);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.toolWarnings,undefined);
 assert.equal((await(await send('tools/list')).json()).result.tools.some(t=>t.name==='present_task'),true);
 assert.equal(f.calls.filter(c=>c.open).length,1);
});

test('an actual dispatched transport failure remains unknown and cannot be turned into inventory warning',async t=>{
 const f=connectionServiceFixture(t),original=f.connections.serviceRequest;
 f.connections.serviceRequest=async packet=>{if(packet.data?.method==='tools/list')throw Error('terminal_service_unknown');return original(packet);};
 const connected=await f.connect();assert.equal(connected.status,'unknown');assert.equal(connected.workflowReady,false);assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'unconfigured');assert.equal(f.calls.filter(c=>c.open).length,1);
});
