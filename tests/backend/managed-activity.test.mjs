import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createConversationActivity} from '../../backend/main/compute/conversation-activity.mjs';
import {managedProjectAccess} from '../../backend/main/compute/managed-project-access.mjs';
import {createRunActionIntents,createScheduleDelegations,runActionTarget} from '../../backend/main/compute/schedule-delegation.mjs';
import {installManagedTray} from '../../desktop/platform/managed-tray.mjs';

function storage() {
 const data=new Map();
 const bucket=k=>{if(!data.has(k))data.set(k,new Map());return data.get(k);};
 return {get:(k,id)=>bucket(k).get(id),put:(k,id,value)=>{bucket(k).set(id,structuredClone(value));return value;},
   list:k=>[...bucket(k).values()].map(row=>structuredClone(row)),remove:(k,id)=>bucket(k).delete(id)};
}
const a={resourceId:'a',profileId:'alpha',kind:'ssh',name:'Center A'};
const b={resourceId:'b',profileId:'beta',kind:'ssh',name:'Center B'};
const local={resourceId:'l',profileId:'local1',kind:'wsl',name:'Developer workstation'};
const one={provider:'codex',threadId:'one',projectId:'p',taskId:'t1'};
const two={provider:'codex',threadId:'two',projectId:'p',taskId:'t2'};

test('persistent badges reflect only the exact source and conversation while turns and wake times update independently',()=>{
 const catalog=storage(),index=createConversationActivity({catalog,now:()=>200});
 for(const p of [a,b,local]) index.style(p);
 for(const r of [a,b,local,a])index.acquired(one,r);
 index.acquired(two,a);
 const colors=catalog.list('compute-resource-style').map(row=>row.color);
 assert.equal(new Set(colors).size,3);
 index.recordRun({scope:one,sourceId:'s1',runId:'shared-id',kind:'cluster-run'});
 const input={resources:[a,b,local],sources:[{id:'s1',profileId:a.profileId,connected:true,observedAt:200,
   runs:[{id:'shared-id',status:'running',observedAt:190}],schedules:[{id:'wake1',kind:'wake_agent',status:'scheduled',scope:two,nextAt:400}]},
   {id:'s2',profileId:b.profileId,connected:true,observedAt:202,runs:[{id:'shared-id',status:'running',observedAt:201}],schedules:[]}],
   turns:[{...one,busy:true}]};
 const [r1,r2]=index.snapshot(input).conversations;
 assert.equal(r1.replying,true);assert.deepEqual(r1.badges.map(x=>[x.label,x.status]),[['Center A','running'],['Center B','idle'],['local','idle']]);
 assert.equal(r2.replying,false);assert.equal(r2.nextWakeAt,400);assert.equal(r2.badges[0].status,'idle');
 // A passive source snapshot timestamp cannot certify a scheduler run.
 const stale=structuredClone(input);
 stale.sources[0].runs[0].observedAt=null;
 assert.equal(index.snapshot(stale).conversations[0].badges[0].status,'unknown');
 index.style({...a,name:'Renamed A'});
 const reloaded=createConversationActivity({catalog}).snapshot({resources:[],turns:[]}).conversations[0];
 assert.equal(reloaded.badges[0].label,'Renamed A');assert.equal(reloaded.badges[0].color,colors[0]);assert.equal(reloaded.badges[0].status,'offline');
 assert.equal(index.runKind(two,'s1','shared-id'),undefined);
});
test('terminal grant follows the verified project and target, schedule delegation originates in the original user turn',()=>{
 const catalog=storage(),access=managedProjectAccess({catalog}),grants=createScheduleDelegations(catalog),resource={...a,targetFingerprint:'target'};
 access.set('p',resource,true);assert.equal(access.includes('p',resource),true);assert.equal(access.includes('other',resource),false);assert.equal(access.includes('p',{...resource,targetFingerprint:'changed'}),false);
 access.set('p',resource,false);assert.equal(access.includes('p',resource),false);
 grants.record({...one,text:'每半小时用脚本监控并唤醒我',turnId:'user-1'});
 assert.equal(grants.assert(one,'upsert',{kind:'script'}),'user-1');assert.equal(grants.assert(one,'upsert',{kind:'wake_agent'}),'user-1');
 assert.throws(()=>grants.assert(two,'upsert',{kind:'poll'}));assert.throws(()=>grants.assert({...one,projectId:'elsewhere'},'upsert',{kind:'script'}));
});

test('schedule discussion grants nothing and a mixed affirmative request delegates polling only',()=>{
 const catalog=storage(),grants=createScheduleDelegations(catalog);
 const blocked=(kind)=>assert.throws(()=>grants.assert(one,kind==='stop'?'stop':'upsert',{kind}),/delegation_required/);
 for(const text of [
  'Explain how to schedule monitoring, run a script, and wake me.',
  'How do I stop monitoring?', 'Could you explain whether to monitor this run?',
  '如何定时执行脚本监控作业并唤醒我？', '是否应该停止轮询？', '能否每半小时监控？',
 ])grants.record({...one,text,turnId:'inquiry'});
 for(const kind of ['poll','action','script','wake_agent','stop'])blocked(kind);
 assert.equal(catalog.list('managed-schedule-delegation').length,0);

 grants.record({...one,text:'Could you monitor this job, but do not run scripts or wake me?',turnId:'poll-en'});
 assert.equal(grants.assert(one,'upsert',{kind:'poll'}),'poll-en');
 assert.equal(grants.assert(one,'upsert',{kind:'action',action:{type:'status'}}),'poll-en');
 assert.throws(()=>grants.assert(one,'upsert',{kind:'action',action:{type:'read_log'}}),/delegation_required/);
 for(const kind of ['action','script','wake_agent','stop'])blocked(kind);
 grants.record({...one,text:'请每隔30分钟轮询该作业，但不要执行脚本也不要唤醒我。',turnId:'poll-zh'});
 assert.equal(grants.assert(one,'upsert',{kind:'poll'}),'poll-zh');
 for(const kind of ['action','script','wake_agent','stop'])blocked(kind);

 for(const text of ['Do not monitor and wake me every hour.', '不要监控并唤醒我。']) {
  grants.record({...one,text:'每半小时用脚本监控并唤醒我',turnId:'combined'});
  grants.record({...one,text,turnId:'joined-negative'});
  for(const kind of ['poll','action','wake_agent','stop'])blocked(kind);
  assert.equal(grants.assert(one,'upsert',{kind:'script'}),'combined');
 }
});

test('later schedule restrictions revoke only their purposes and explicit stop requires a direct request',()=>{
 const grants=createScheduleDelegations(storage());
 const put=(text,turnId,scope=one)=>grants.record({...scope,text,turnId});
 const allowed=(kind)=>grants.assert(one,kind==='stop'?'stop':'upsert',{kind,action:{type:'read_log'}});
 const blocked=(kind)=>assert.throws(()=>allowed(kind),/delegation_required/);
 put('每半小时用脚本监控并唤醒我','combined');
 put('Every hour, please read the job log.','log');
 assert.equal(allowed('action'),'log');
 blocked('stop');

 put('How should I stop monitoring or run the script?', 'question');
 put('Do not run the monitoring script.', 'other-task', {...one,taskId:'different'});
 assert.equal(allowed('script'),'combined');
 put('Do not run the monitoring script.', 'restrict-script');
 blocked('script');
 assert.equal(allowed('poll'),'combined');
 assert.equal(allowed('wake_agent'),'combined');
 assert.equal(allowed('action'),'log');
 put('请勿唤醒我。', 'restrict-wake');
 blocked('wake_agent');
 assert.equal(allowed('poll'),'combined');
 blocked('stop');
 put('Please stop monitoring this job.', 'explicit-stop');
 assert.equal(allowed('stop'),'explicit-stop');
 blocked('poll');
 put('请重新核对这个作业。', 'unrelated');
 assert.equal(allowed('stop'),'explicit-stop');
 put('Please start monitoring this job every 30 minutes.', 'restart');
 assert.equal(allowed('poll'),'restart');
 blocked('stop');
});

test('legacy keyword grants remain recorded and a fresh direction establishes only its evidenced purpose',()=>{
 const catalog=storage(),grants=createScheduleDelegations(catalog);
 const namespace='managed-schedule-delegation';
 const key=JSON.stringify([one.provider,one.threadId]);
 const legacy={...one,permissions:['stop','poll','action','script','wake_agent'],turnId:'legacy'};
 catalog.put(namespace,key,legacy);

 const operations=[
  ['stop',{}],['upsert',{kind:'poll'}],['upsert',{kind:'action',action:{type:'status'}}],
  ['upsert',{kind:'action',action:{type:'read_log'}}],['upsert',{kind:'script'}],['upsert',{kind:'wake_agent'}],
 ];
 for(const [operation,args] of operations)assert.throws(()=>grants.assert(one,operation,args),/delegation_required/);
 grants.record({...one,text:'How do I stop monitoring?',turnId:'inquiry'});
 assert.deepEqual(catalog.get(namespace,key),legacy);
 grants.record({...one,text:'Please read the run log every hour.',turnId:'log-only'});
 assert.deepEqual(catalog.get(namespace,key).legacyGrant,legacy);
 for(const [operation,args] of operations) {
  if(args.action?.type==='read_log')assert.equal(grants.assert(one,operation,args),'log-only');
  else assert.throws(()=>grants.assert(one,operation,args),/delegation_required/);
 }
 assert.throws(()=>grants.assert(one,'upsert',{kind:'action'}),/delegation_required/);

 grants.record({...one,text:'Please poll the job every hour.',turnId:'status'});
 assert.equal(grants.assert(one,'upsert',{kind:'action',action:{type:'status'}}),'status');
 assert.equal(grants.assert(one,'upsert',{kind:'action',action:{type:'read_log'}}),'log-only');
 for(const [operation,args] of operations.filter(([operation,args])=>operation==='stop'||['script','wake_agent'].includes(args.kind))) {
  assert.throws(()=>grants.assert(one,operation,args),/delegation_required/);
 }
});

test('a standalone submit instruction applies to its original project and conversation',()=>{
 const intents=createRunActionIntents(),chat={...one,taskId:null},candidates=[{sourceId:'worker',runId:'one-run'}];
 const permits=scope=>intents.permits(scope,'submit','one-run',candidates,'Fixture');
 intents.record({...chat,projectId:null,text:'请提交这个独立作业',turnId:'before-selection'});
 assert.equal(permits(chat),false);
 intents.record({...chat,text:'请提交这个独立作业',turnId:'confirmed'});
 assert.equal(permits(chat),true);
 assert.equal(permits({...chat,projectId:'other-project'}),false);
 assert.equal(permits({...chat,threadId:'another-chat'}),false);
 intents.record({...chat,text:'不要提交这个独立作业',turnId:'revoked'});
 assert.equal(permits(chat),false);
});

test('a new independent job authorizes one current-turn draft and preserves older run identities',()=>{
 const intents=createRunActionIntents(),chat={...one,taskId:null,checkCurrent:()=>true};
 const fresh={sourceId:'worker-a',resourceId:'ssh:a',runId:'run-new'},old={...fresh,runId:'run-old'};
 const other={...fresh,sourceId:'worker-b',resourceId:'ssh:b'};
 const candidates=[old,fresh,other];
 const permits=ref=>intents.permits(chat,'submit',ref.runId,candidates,'Center A',ref);
 for(const [turn,text] of ['请提交一个 GPUMD 短测','用现有环境帮我跑一个 GPUMD 短测','Submit one test and show me its queue status.','Use the current environment and run a GPUMD short test.'].entries()){
  intents.record({...chat,text,turnId:'turn-'+turn});
  assert.equal(permits(old),false,text);assert.equal(permits(fresh),false,text);
  const capture=intents.capturePreparation(chat);assert.equal(capture.turnId,'turn-'+turn);
  capture.record(fresh);capture.record(old);
  assert.equal(permits(fresh),true,text);assert.equal(permits(old),false,text);assert.equal(permits(other),false,text);
  intents.record({...chat,text:'请提交一个 GPUMD 短测',turnId:'next-'+turn});
  capture.record(fresh);assert.equal(permits(fresh),false);
 }
 for(const text of ['Run a read-only queue check on cluster-a.','Start the environment setup.',
  'Run a queue query to list all jobs on cluster-a.','Start by checking the status of existing jobs on cluster-a.',
  '提交一次短测。请不要在我确认之前实际提交。','请只准备一个 GPUMD 短测草稿','运行一次测试，但先别实际运行',
  'Submit a GPUMD test. Wait for my approval.','Run through the submission example.','Show me how to submit a GPUMD job.',
  'Review this example.\n```text\nSubmit a GPUMD test\n```','提交一次测试。暂不实际提交。']){
  intents.record({...chat,text,turnId:'not-a-submit'});
  assert.equal(intents.capturePreparation(chat),undefined,text);
  assert.equal(intents.permits(chat,'submit',old.runId,[old],'Center A',old),false,text);
 }
});

test('run execution or validation requires a direct human action and retains the exact scope',()=>{
 const intents=createRunActionIntents();
 const candidates=[{sourceId:'s1',runId:'run-1'}];
 const record=text=>intents.record({...one,text,turnId:'human'});
 const permits=(action,scope=one)=>intents.permits(scope,action,'run-1',candidates,'Center A');
 for(const [action,text] of [
  ['submit','Please explain how to submit run-1.'],['submit','如何提交这个作业？'],
  ['submit','Submit run-1 only after the input has passed the check.'],['submit','请提交这个作业，前提是模型已通过检查。'],
  ['cancel','Can you tell me whether to cancel run-1?'],['cancel','能否取消此作业？'],
  ['validate','How would you validate run-1?'],['validate','是否可以检查这个作业？'],
  ['validate','Please check if I should validate run-1.'],
  ['validate','Please check the status of run-1.'],['validate','请检查这个作业的状态。'],
  ['submit','Please run a script to monitor run-1.'],['submit','启动定时监控。'],
  ['cancel','Please stop monitoring run-1.'],['cancel','请停止监控这个作业。'],
  ['cancel','Please stop the current job’s monitoring.'],['cancel','请停止这个作业的监控。'],
  ['submit','Submit run-1. Do not submit it.'],['submit','先别提交这个作业。'],
  ['submit','Submit run-1 and do not submit it.'],['submit','提交这个作业并不要提交它。'],
 ]) {
  record(text);
  assert.equal(permits(action),false,text);
 }
 for(const [action,text] of [
  ['submit','Could you please submit run-1?'],['submit','请帮我提交这个作业。'],
  ['cancel','Cancel run-1 now.'],['cancel','麻烦帮我取消 run-1。'],
  ['validate','Please validate run-1.'],['validate','请核验这个作业。'],
 ]) {
  record(text);
  assert.equal(permits(action),true,text);
  assert.equal(permits(action,two),false);
  assert.equal(permits(action,{...one,projectId:'other'}),false);
  assert.equal(permits(action,{...one,taskId:'other'}),false);
  assert.equal(permits(action,{...one,provider:'qwen'}),false);
 }
 for(const text of [
  'submit run_id:other-id','Submit run ID "other-id".','Submit run-2.',
  'Please submit 12b58179-fc15-4065-94c5-ceabf19923ff.', '请提交作业编号：run-2。',
 ]) {
  record(text);
  assert.equal(permits('submit'),false,text);
 }
 for(const text of ['submit this job','Please submit run_id:run-1.', '请提交作业run-1。']) {
  record(text);
  assert.equal(permits('submit'),true,text);
 }
});

test('multiple run choices require a complete ID in the command and an exact target for shared IDs',()=>{
 const resources=[{resourceId:'ssh:a',name:'Lab'},{resourceId:'ssh:b',name:'lab'}];
 assert.equal(runActionTarget(resources,'ssh:a'),'ssh:a');
 assert.equal(runActionTarget(resources,'ssh:b'),'ssh:b');
 assert.equal(runActionTarget(resources,'ssh:c'),null);
 const intents=createRunActionIntents();
 const oneRun={sourceId:'s1',runId:'run-1'};
 const distinct=[oneRun,{sourceId:'s2',runId:'run-10'}];
 const shared=[oneRun,{sourceId:'s2',runId:'run-1'}];
 const delegates=(text,candidates=distinct,target='Center A')=>{
  intents.record({...one,text,turnId:'human'});
  return intents.permits(one,'cancel','run-1',candidates,target);
 };
 assert.equal(delegates('Cancel run-10.'),false);
 assert.equal(delegates('Cancel prefix-run-1.'),false);
 assert.equal(delegates('Cancel run-1-extra.'),false);
 assert.equal(delegates('Cancel run-10. Explain run-1.'),false);
 assert.equal(delegates('Please cancel run-1.'),true);
 assert.equal(delegates('请取消作业run-1。'),true);
 assert.equal(delegates('Cancel run-1.', shared),false);
 assert.equal(delegates('Cancel run-1 on Center AB.', shared),false);
 assert.equal(delegates('Cancel run-1 on Center A East.', shared),false);
 assert.equal(delegates('Cancel run-1 on East Center A.', shared),false);
 assert.equal(delegates('Cancel run-1 on Center A.', shared),true);
 assert.equal(delegates('Cancel run-1 on "CENTER A".', shared),true);
 assert.equal(delegates('请在 Center A 上取消 run-1。', shared),true);
 assert.equal(delegates('请在 Center AB 上取消 run-1。', shared),false);
});

test('closing window hides it, reopening retains the same owner and explicit tray quit enters app cleanup',()=>{
 const app=new EventEmitter(),window=new EventEmitter();let visible=true,quit=false,menu;
 Object.assign(window,{isDestroyed:()=>false,isMinimized:()=>false,show(){visible=true;},hide(){visible=false;},focus(){}});
 app.quit=()=>{quit=true;};
 class Tray extends EventEmitter{setToolTip(){}setContextMenu(value){menu=value;}isDestroyed(){return false;}destroy(){}}
 const tray=installManagedTray({app,window,Tray,Menu:{buildFromTemplate:value=>value},icon:{},language:()=>'en',isQuitting:()=>quit});
 let prevented=false;
 window.emit('close',{preventDefault(){prevented=true;}});
 assert(prevented);assert(!visible);assert(!quit);
 tray.show();assert(visible);menu.at(-1).click();assert(quit);
 window.emit('close',{preventDefault(){assert.fail('explicit quit was intercepted');}});
 app.emit('will-quit');
});
