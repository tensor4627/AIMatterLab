import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createComputeResourceBinding} from '../../backend/main/compute/resource-binding.mjs';
import {createComputeProfiles} from '../../backend/main/compute/compute-profiles.mjs';

function fixture(){
 const rows=new Map(),catalog={get:(kind,id)=>structuredClone(rows.get(kind+':'+id)??null),put:(kind,id,value)=>rows.set(kind+':'+id,structuredClone(value)),remove:(kind,id)=>rows.delete(kind+':'+id),transaction:fn=>fn()};
 const profile={id:'profile',version:1,kind:'ssh'},choice={kind:'ssh-connection',connectionId:'connection-a',profileId:profile.id,profileVersion:1};
 let owner={provider:'codex',threadId:'thread',taskId:null},serial=0,ids=0,delay=null;
 const state={schemaVersion:2,connectionId:choice.connectionId,profileId:profile.id,profileVersion:1,status:'authenticated',authentication:'verified',capabilities:{multiplex:true},terminalSessionIds:[],serviceIds:[],revision:1};
 const shells=new Map(),service={schemaVersion:2,connectionId:choice.connectionId,profileId:profile.id,profileVersion:1,status:'disconnected',operator:'human',workflowReady:false};
 const connections={state:async()=>{const value=structuredClone(state);if(delay)await delay;return value;}},terminal={connections,resourceState:async({sessionId})=>{if(!shells.has(sessionId))throw Error('terminal_unavailable');return structuredClone(shells.get(sessionId));}};
 const api=createComputeResourceBinding({catalog,profiles:{read:()=>profile},terminal,connections,current:()=>owner,revision:()=>serial,serviceState:()=>structuredClone(service),uuid:()=> 'selection-'+ ++ids});
 return {api,rows,catalog,choice,state,shells,service,hold:value=>delay=value,context:value=>{owner=value;serial++;},shell:(id='shell-a',agent=false)=>{state.terminalSessionIds=[id];shells.set(id,{connectionId:state.connectionId,sessionId:id,operator:agent?'agent':'human',agentReady:agent,alive:true,processStatus:'running'});}};
}
test('a verified connection is a resource without either optional channel and conveys no Agent or file authorization',async()=>{
 const f=fixture(),value=await f.api.activate(f.choice);assert.equal(value.schemaVersion,2);assert.equal(value.authentication,'verified');assert.equal(value.agentReady,false);assert.equal(value.sessionId,null);assert.equal(value.capabilities.terminal.status,'closed');assert.equal(value.capabilities.service.status,'disconnected');assert.equal(value.capabilities.files.status,'unavailable');assert.equal(f.api.peek().sessionId,undefined);
});
test('closing all shell channels preserves the exact selected connection ticket and service-use capability',async()=>{
 const f=fixture();f.shell();Object.assign(f.service,{status:'connected',workflowReady:true,operator:'agent'});await f.api.activate(f.choice);const ticket=f.api.capture();f.state.terminalSessionIds=[];const value=await f.api.status({});f.api.assertCurrent(ticket);assert.equal(value.agentReady,true);assert.equal(value.workflowReady,true);assert.equal(value.capabilities.terminal.status,'closed');assert.equal(value.capabilities.files.status,'requires_authorized_project');assert.equal(value.capabilities.service.agentReady,true);
});
test('service loss leaves an independently verified and granted shell available',async()=>{
 const f=fixture();f.shell('shell-a',true);Object.assign(f.service,{status:'unknown',workflowReady:false,operator:'human'});const value=await f.api.activate(f.choice);assert.equal(value.agentReady,true);assert.equal(value.workflowReady,false);assert.equal(value.capabilities.service.agentReady,false);assert.equal(value.capabilities.terminal.agentReady,true);assert.equal(value.capabilities.files.status,'unknown');
});
test('a shell observation failure cannot erase the authenticated connection or a verified service',async()=>{
 const f=fixture();f.state.terminalSessionIds=['exited-between-reads'];Object.assign(f.service,{status:'connected',workflowReady:true,operator:'agent'});const value=await f.api.activate(f.choice);assert.equal(value.status,'selected');assert.equal(value.agentReady,true);assert.equal(value.capabilities.terminal.status,'unknown');assert.equal(value.capabilities.service.agentReady,true);
});
test('parent loss invalidates both cached capabilities without altering any run or registration record',async()=>{
 const f=fixture();f.shell('shell-a',true);Object.assign(f.service,{status:'connected',workflowReady:true,operator:'agent'});await f.api.activate(f.choice);f.catalog.put('real-run','unchanged',{status:'running'});const before=f.catalog.get('real-run','unchanged');f.state.status='unavailable';f.state.authentication='lost';const value=await f.api.status({});assert.equal(value.agentReady,false);assert.equal(value.workflowReady,false);assert.equal(value.authentication,'lost');assert.equal(value.alive,null);assert.equal(value.capabilities.terminal.status,'unknown');assert.equal(value.capabilities.service.status,'unknown');assert.deepEqual(f.catalog.get('real-run','unchanged'),before);
});
test('pending authentication, unsupported clients and foreign identities cannot replace the existing selection',async()=>{
 for(const mode of ['pending','unsupported','foreign']){const f=fixture();await f.api.activate(f.choice);const before=f.api.peek();f.state.connectionId='connection-b';if(mode==='pending'){f.state.status='authenticating';f.state.authentication='pending';}if(mode==='unsupported'){f.state.status='unsupported';f.state.authentication='not_observed';}if(mode==='foreign')f.state.profileId='foreign';await assert.rejects(f.api.activate({...f.choice,connectionId:'connection-b'}));assert.deepEqual(f.api.peek(),before);}
});
test('a late connection observation cannot cross a conversation change',async()=>{
 const f=fixture();let release;f.hold(new Promise(resolve=>release=resolve));const pending=f.api.activate(f.choice);f.context({provider:'codex',threadId:'other',taskId:null});release();await assert.rejects(pending,/context_changed/);assert.equal(f.api.peek(),null);
});
test('explicit schema2 selection archives a schema1 reference without transferring authentication or grants',async()=>{
 const f=fixture(),old={schemaVersion:1,selectionId:'legacy-selection',kind:'ssh-terminal',profileId:'profile',profileVersion:1,sessionId:'legacy-shell'};f.catalog.put('compute-resource-selection','active',old);assert.deepEqual(f.api.peek(),old);const value=await f.api.activate(f.choice);assert.equal(value.agentReady,false);const history=f.catalog.get('compute-resource-selection-history',old.selectionId);assert.equal(history.fromSchemaVersion,1);assert.equal(history.toSchemaVersion,2);assert.deepEqual(history.previous,old);assert.equal(f.api.peek().kind,'ssh-connection');
});

test('immutable profile migration retains only real saved versions and survives catalog reopening',t=>{
 const base=path.resolve('.studio/compute-connection-profile-tests');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'history-'));let catalog=new Catalog(root);
 const original={id:'00000000-0000-4000-8000-000000000001',version:7,kind:'ssh',name:'Existing saved route',host:'fixture.invalid',username:'fixture',port:22,ssh_client:'/usr/bin/ssh',mode:'interactive'};catalog.put('compute-profile',original.id,original);catalog.put('real-run','keep',{id:'keep',status:'unknown'});
 let profiles=createComputeProfiles({catalog});assert.equal(profiles.read({id:original.id,version:7}).host,original.host);assert.throws(()=>profiles.read({id:original.id,version:6}),/changed/);const {id,version,...body}=original,updated=profiles.save({id,expectedVersion:version,...body,host:'reviewed-new.invalid'});assert.equal(updated.version,8);assert.equal(profiles.read({id,version:7}).host,'fixture.invalid');assert.equal(profiles.read({id}).host,'reviewed-new.invalid');assert.throws(()=>profiles.remove({id,expectedVersion:7}),/changed/);catalog.db.close();
 catalog=new Catalog(root);t.after(()=>catalog.db.close());profiles=createComputeProfiles({catalog});assert.equal(profiles.read({id,version:7}).host,'fixture.invalid');assert.equal(profiles.read({id,version:8}).host,'reviewed-new.invalid');assert.deepEqual(catalog.get('real-run','keep'),{id:'keep',status:'unknown'});const snapshot=catalog.get('compute-profile-version',id+':7');snapshot.profile.host='corrupted.invalid';catalog.put('compute-profile-version',id+':7',snapshot);assert.throws(()=>profiles.read({id,version:7}),/history_changed/);
});
