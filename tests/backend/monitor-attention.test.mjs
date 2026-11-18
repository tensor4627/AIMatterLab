import test from 'node:test';
import assert from 'node:assert/strict';
import {createMonitorAttention} from '../../backend/main/compute/monitor-attention.mjs';

function fixture() {
  const data=new Map(),announcements=[];
  const catalog={get:(_k,id)=>data.get(id),put:(_k,id,value)=>data.set(id,value),list:()=>[...data.values()]};
  const open=()=>createMonitorAttention({catalog,now:()=>500,announce:record=>announcements.push(record)});
  const scope={projectId:'p',provider:'codex',threadId:'t',runId:'run-1'};
  const plan={id:'poll-1',kind:'poll',scope,status:'exhausted',count:48,maxRuns:48,active:null};
  const run={projectId:'p',id:'run-1',status:'running',jobId:'123',observedAt:490};
  const source={id:'original',profileId:'cluster-a',connected:true,schedules:[plan],runs:[run]};
  return {open,source,plan,run,announcements};
}
test('alert follows the final original job receipt once, survives restart and never reopens when acknowledged',()=>{
 const f=fixture(),notices=f.open();
 f.plan.status='running';f.plan.active={id:'last'};notices.reconcile([f.source]);assert.equal(notices.list().length,0);
 f.plan.status='exhausted';f.plan.active=null;notices.reconcile([f.source]);notices.reconcile([f.source]);
 const [notice]=notices.list();assert.equal(notice.jobId,'123');assert.equal(notice.observedAt,490);assert.equal(f.announcements.length,1);
 const reopened=f.open();reopened.reconcile([f.source]);assert.equal(f.announcements.length,1);
 reopened.acknowledge(notice.id);assert.equal(reopened.list()[0].acknowledgedAt,500);
 f.run.status='succeeded';reopened.reconcile([f.source]);assert.deepEqual(reopened.list(),[]);
 f.run.status='unknown';reopened.reconcile([f.source]);assert.deepEqual(reopened.list(),[]);assert.equal(f.announcements.length,1);
});
test('completion including scheduler terminal, stop, expiry, unrelated scripts and an offline replay trigger no exhaustion notification',()=>{
 for(const change of [
   f=>{f.run.status='failed';}, f=>{f.run.status='unknown';f.run.schedulerTerminal=true;},
   f=>{f.plan.status='expired';},f=>{f.plan.status='stopped';},f=>{f.plan.stopRequestedAt=40;},
   f=>{f.plan.kind='script';},f=>{f.plan.kind='wake_agent';},f=>{f.source.connected=false;}
 ]){const f=fixture();change(f);f.open().reconcile([f.source]);assert.equal(f.announcements.length,0);}
});
test('source and project determine the run; unknown gets its own follow-up and shared budget is distinguished',()=>{
 const f=fixture(),n=f.open();f.run.projectId='other';f.plan.count=3;f.plan.delegationCount=336;
 n.reconcile([f.source,{...f.source,id:'other',schedules:[],runs:[{...f.run,projectId:'p',status:'succeeded'}]}]);
 const [notice]=n.list();assert.equal(notice.status,'unknown');assert.equal(notice.jobId,null);assert.equal(notice.delegationExhausted,true);
});
