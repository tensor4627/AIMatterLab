import test from 'node:test';
import assert from 'node:assert/strict';
import {messageForItem,replayMessages,upsertItemMessage} from '../../frontend/features/conversations/message-mapping.mjs';
import {createReadingPositions,readingKey} from '../../frontend/features/conversations/reading-position.mjs';
import {agentHarness,conversation,memoryStorage} from '../helpers/agent-hooks.mjs';
import {deploymentFixture,deploymentHarness} from '../helpers/deployment-diagnostic-hooks.mjs';
import {snapshotIdentity} from '../../contracts/compute/deployment.mjs';
import {runDetailHarness} from '../helpers/run-detail-hooks.mjs';

test('native provider web searches share live and replay activity identity',()=>{
 const event={id:'lookup',type:'webSearch',action:{type:'search',queries:['tool documentation']}};
 const first=upsertItemMessage([],{...event,status:'inProgress'});
 assert.equal(first[0].activity.state,'running');
 const result=upsertItemMessage(first,{...event,status:'completed'});
 assert.equal(result.length,1);
 assert.deepEqual(result,replayMessages([{items:[event]}]));
 assert.equal(result[0].activity.details,'tool documentation');
});

test('command and file replay matches live completion, including failed exit codes and late start omission',()=>{
 const items=[{id:'user',type:'userMessage',content:[{type:'text',text:'Fix this input'},{type:'text',text:'[Studio workspace context]\n{}'}]},{id:'command',type:'commandExecution',command:'python run.py',cwd:'/owned',aggregatedOutput:'Traceback: invalid input',exitCode:1,status:'completed'},{id:'file',type:'fileChange',status:'completed',changes:[{path:'run.py',kind:{type:'update'},diff:'-old\n+new'}]}];
 const replay=replayMessages([{items}]);let live=[];for(const item of items)live=upsertItemMessage(live,item);assert.deepEqual(live,replay);assert.equal(replay[0].text,'Fix this input');assert.equal(replay[1].activity.state,'failed');assert.match(replay[1].activity.details,/exit: 1/);assert.match(replay[2].activity.details,/run.py\n-old\n\+new/);
 assert.equal(upsertItemMessage(live,items[1]).length,3);assert.equal(messageForItem({id:'ignored',type:'unknown'}),null);
 const duplicate={...items[1],aggregatedOutput:'Final captured output',exitCode:0};const combined=replayMessages([{items},{items:[duplicate]}]);assert.deepEqual(combined.map(value=>value.id),['user','command','file']);assert.match(combined[1].activity.details,/Final captured output/);assert.equal(combined[1].activity.state,'completed');
});

test('reading positions restore an anchor offset after layout changes, fall back to absolute top, and isolate providers',()=>{
 const storage=memoryStorage(),positions=createReadingPositions(()=>storage),key=readingKey('codex','same'),node={scrollTop:210,scrollHeight:2000,getBoundingClientRect:()=>({top:100}),querySelectorAll:()=>[{dataset:{messageId:'anchor'},getBoundingClientRect:()=>({top:90,bottom:240})}],scrollTo({top}){this.scrollTop=top;}};
 positions.save(key,node,false);node.scrollTop=0;node.querySelectorAll=()=>[{dataset:{messageId:'anchor'},getBoundingClientRect:()=>({top:390,bottom:540})}];assert.equal(positions.restore(key,node),false);assert.equal(node.scrollTop,300);assert.equal(positions.read(readingKey('kimi','same')),null);
 const reloaded=createReadingPositions(()=>storage);node.querySelectorAll=()=>[];node.scrollTop=0;reloaded.restore(key,node);assert.equal(node.scrollTop,210);positions.save(key,node,true);positions.restore(key,node);assert.equal(node.scrollTop,2000);
});

test('actual Agent restores per-conversation reading position and drafts across switch, collapse and reload without sending',async()=>{
 const storage=memoryStorage(),props={sessionSelection:{nonce:'a',conversation:conversation('codex','a')}},override=(method,data,standard)=>method==='agent.rpc'&&data.method==='thread/read'?{thread:{id:data.params.threadId,turns:[{items:[{id:data.params.threadId+'-history',type:'agentMessage',text:'Long saved history'}]}]}}:standard(method,data);
 const host={scrollTop:0,clientHeight:400,scrollHeight:2400,scrollTo({top}){this.scrollTop=Math.min(top,this.scrollHeight-this.clientHeight);}},attach=h=>h.find(node=>node.props?.className==='chat-scroll').props.ref.current=host;
 let h=agentHarness({storage,props,override});attach(h);await h.flush();h.type('Draft A');host.scrollTop=315;h.find(node=>node.props?.className==='chat-scroll').props.onScroll();await h.flush();
 h.render({sessionSelection:{nonce:'b',conversation:conversation('codex','b')}});await h.flush();h.type('Draft B');assert.equal(host.scrollTop,2000);h.render({sessionSelection:{nonce:'a-again',conversation:conversation('codex','a')}});await h.flush();assert.equal(host.scrollTop,315);assert.equal(h.textarea().props.value,'Draft A');h.render({hidden:true});await h.flush();h.render({hidden:false});await h.flush();assert.equal(host.scrollTop,315);h.unmount();
 host.scrollTop=0;h=agentHarness({storage,props,override});attach(h);await h.flush();assert.equal(host.scrollTop,315);assert.equal(h.textarea().props.value,'Draft A');assert.equal(h.calls.filter(call=>call.method==='agent.rpc'&&call.data.method==='turn/start').length,0);h.unmount();
});

for(const status of ['not_run','stale','failed'])test('deployment review '+status+' is advisory and execution retains immutable input identity',async()=>{
 const initial=deploymentFixture();initial.task.review={status:status==='stale'?'ready':status,parameterRevision:status==='stale'?1:3};let executed;
 const h=deploymentHarness({initial,override:(method,data,standard)=>{if(method==='task.execute'){executed=data;return {...initial.run,status:'queued'};}return standard(method,data);}});await h.flush();assert.equal(h.find(node=>node.props?.['data-testid']==='execute-deployment').props.disabled,false);h.click('execute-deployment');await h.flush();assert.deepEqual(executed,{taskId:initial.task.id,artifactId:initial.run.id,inputReceipt:snapshotIdentity(initial.task,initial.run)});assert.deepEqual(h.props.task.review,initial.task.review);h.unmount();
});

test('Save and run saves deployment, prepares a snapshot and executes in one explicit action without manual review checkbox',async()=>{
 const initial=deploymentFixture();delete initial.task.deployment.prepared;initial.task.review={status:'not_run'};initial.task.artifacts=[];let h;
 h=deploymentHarness({initial,override:(method,data,standard)=>{if(method==='task.deployment.prepare'){const task=h.servers.get(data.taskId);task.deployment.prepared={artifactId:initial.run.id,parameterRevision:task.parameterRevision,deploymentRevision:task.deployment.revision};task.deployment.prepared.inputIdentity=snapshotIdentity(task,initial.run);return structuredClone(initial.run);}if(method==='task.execute')return {...initial.run,status:'queued'};return standard(method,data);}});await h.flush();h.click('execute-deployment');await h.flush();const mutations=h.calls.filter(call=>['task.deployment.save','task.deployment.prepare','task.execute'].includes(call.method));assert.deepEqual(mutations.map(call=>call.method),['task.deployment.save','task.deployment.prepare','task.execute']);assert.equal(mutations[2].data.inputReceipt,snapshotIdentity(h.props.task,initial.run));h.unmount();
});

test('unknown attempt blocks duplicate execution while optional workflow metadata stays advisory',async()=>{
 const initial=deploymentFixture();initial.task.execution={phase:'unknown',artifactId:initial.run.id};const h=deploymentHarness({initial});await h.flush();assert.equal(h.find(node=>node.type==='fieldset').props.disabled,false);assert.equal(h.find(node=>node.props?.['data-testid']==='execute-deployment').props.disabled,true);h.target('env-B');await h.flush();assert.equal(h.props.task.deploymentDraft.config.targetId,'env-B');assert.equal(h.calls.filter(call=>call.method==='task.execute').length,0);h.unmount();
 const missing=deploymentFixture();missing.task.missingFields=['structure'];const m=deploymentHarness({initial:missing});await m.flush();assert.equal(m.find(node=>node.props?.['data-testid']==='execute-deployment').props.disabled,false);m.unmount();
});

test('current input findings stay visible as optional details without changing review or execution permission',async()=>{
 const initial=deploymentFixture();initial.task.review={status:'not_run'};initial.task.inputBinding={artifactId:initial.run.id,parameterRevision:3,findings:[{status:'warning',code:'semantic_binding_unverified',message:'Declared controls changed; actual input bytes remain unchanged.'}]};const h=deploymentHarness({initial});await h.flush();const findings=h.find(node=>node.props?.['data-testid']==='deployment-input-findings');assert.equal(findings.props.open,undefined);assert.match(h.text(findings),/actual input bytes/);assert.equal(h.find(node=>node.props?.['data-testid']==='execute-deployment').props.disabled,false);h.unmount();
});

test('voluntary local consumer review never adds a required human target confirmation',async()=>{
 const initial=deploymentFixture();Object.assign(initial.task,{provider:'codex',threadId:'consumer',parameters:{engine:'bias.validate'},review:{status:'not_run'}});const h=deploymentHarness({initial,override:async(method,data,standard)=>{
  if(method==='task.localReview.status')return {taskId:initial.task.id,parameterRevision:3,provider:'codex',threadId:'consumer',status:'current',scope:'local',authority:{kind:'local-human',id:'human-review',sha256:'a'.repeat(64)}};
  if(method==='task.deployment.context'){const value=await standard(method,data);return {...value,projects:value.projects.map(project=>({...project,policy:{...project.policy,engines:['bias.validate']}}))};}
  return standard(method,data);
 }});await h.flush();assert.match(h.text(h.find(node=>node.props?.['data-testid']==='deployment-target-advisory')),/可继续运行/);assert.equal(h.find(node=>node.props?.['data-testid']==='execute-deployment').props.disabled,false);assert.equal(h.calls.filter(call=>call.method==='task.execute').length,0);h.unmount();
});

test('existing prepared run with a foreign status identity blocks execution instead of silently preparing another attempt',async()=>{
 const h=deploymentHarness({override:(method,data,standard)=>method==='worker.request'&&data.target==='/api/run/status'?{id:'foreign',status:'draft'}:standard(method,data)});await h.flush();assert.equal(h.find(node=>node.props?.['data-testid']==='execute-deployment').props.disabled,true);assert.equal(h.calls.filter(call=>call.method==='task.execute'||call.method==='task.deployment.prepare').length,0);h.unmount();
});

test('direct draft run submits once without a passed review; superseded and workflow-owned changes block captured submit handlers',async()=>{
 const run={id:'draft',name:'Unreviewed run',engine:'pydyn.md',status:'draft',validation:{status:'not_run'},project_id:'project',environment_id:'env',command:[],inputs:{},parameters:{},directory:'/owned/draft',created_at:1,max_seconds:60,gpu:0};const h=runDetailHarness({props:{run},request:async(target,data)=>({...run,status:'queued'})});await h.flush();const submit=h.button('提交计算');assert.equal(submit.props.disabled,false);submit.props.onClick();submit.props.onClick();await h.flush();assert.deepEqual(h.calls.map(value=>({target:value.target,id:value.data.run_id})),[{target:'/api/run/submit',id:run.id}]);assert.equal(run.validation.status,'not_run');h.unmount();
 for(const patch of [{superseded_by:'next'},{studio_workflow_binding:{}}]){const owned=runDetailHarness({props:{run}});await owned.flush();const stale=owned.button('提交计算');owned.render({run:{...run,...patch}});await owned.flush();stale.props.onClick();await owned.flush();assert.equal(owned.calls.length,0);owned.unmount();}
});

test('a selected repair conversation receives its draft once while another conversation replies',async()=>{
 const first=conversation('codex','a'),target=conversation('codex','b');
 const repair={id:'repair-b',provider:target.provider,threadId:target.threadId,text:'Diagnose the saved run failure',autoSend:false};
 const h=agentHarness({props:{sessionSelection:{nonce:'a',conversation:first}}});
 try{
  await h.flush();
  h.type('Original request');h.send();await h.flush();
  h.find(node=>node.props?.['data-testid']==='agent-stop');
  h.type('Keep unsent draft in A');
  h.render({sessionSelection:{nonce:'b',conversation:target},intent:repair});await h.flush();
  assert.equal(h.textarea().props.value,repair.text);
  h.emit({provider:'codex',method:'turn/completed',params:{threadId:first.threadId,turn:{id:'accepted-turn',status:'completed'}}});
  await h.flush();
  assert.equal(h.textarea().props.value,repair.text);
  h.type('Edited repair draft');
  h.render({hidden:true});await h.flush();h.render({hidden:false});await h.flush();
  assert.equal(h.textarea().props.value,'Edited repair draft');
  h.render({sessionSelection:{nonce:'a-again',conversation:first},intent:undefined});await h.flush();
  assert.equal(h.textarea().props.value,'Keep unsent draft in A');
  h.render({sessionSelection:{nonce:'b-again',conversation:target},intent:repair});await h.flush();
  assert.equal(h.textarea().props.value,'Edited repair draft');
  assert.deepEqual(h.calls.filter(call=>call.method==='agent.rpc'&&['turn/start','turn/interrupt'].includes(call.data.method)).map(call=>[call.data.method,call.data.params.threadId]),[['turn/start',first.threadId]]);
 }finally{h.unmount();}
});
