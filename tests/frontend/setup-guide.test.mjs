import test from 'node:test';
import assert from 'node:assert/strict';
import {appWorkerHarness} from '../helpers/app-worker-hooks.mjs';
import {agentHarness,conversation} from '../helpers/agent-hooks.mjs';

const guide=h=>h.find(node=>node.type==='./SetupAssistant');
const shell=h=>h.find(node=>node.props?.className?.startsWith?.('shell workspace-shell'));
const help=h=>h.find(node=>node.props?.['data-testid']==='open-setup-guide');
function fixture(page='welcome',failWrite=false){
 const info={page,directory:'synthetic workspace',directoryKind:'workspace'};
 return appWorkerHarness({override:async(method,data,standard)=>{
  if(method==='state')return {...await standard(method,data),setupGuide:{...info}};
  if(method==='onboarding.progress'){
   if(failWrite)throw Error('write unavailable');
   if(info.page!=='complete')info.page=data.page;
   return {...info};
  }
  return standard(method,data);
 }});
}
test('one-step progress, skip and voluntary replay do not connect or send a message',async()=>{
 const h=fixture();try{
  await h.flush();assert.equal(guide(h).props.page,'welcome');assert.equal(shell(h).props.inert,true);
  await guide(h).props.onProgress('agent');await h.flush();
  await guide(h).props.onPreferences({agentProvider:'qwen'});await h.flush();
  assert.equal(h.find(n=>n.type==='./Agent').props.setupProviderChoice.provider,'qwen');
  await guide(h).props.onProgress('complete');await h.flush();assert.equal(shell(h).props.inert,undefined);
  help(h).props.onClick();await h.flush();assert.equal(guide(h).props.page,'welcome');
  assert.ok(!h.calls.some(c=>['agent.login','agent.rpc','worker.connect','compute.connection.connect','compute.sshConnection.open','task.execute'].includes(c.method)));
 }finally{h.unmount();}
});
test('failed progress stays on the current page and a pre-existing profile uses the ordinary workspace',async()=>{
 const h=fixture('compute',true);try{
  await h.flush();await assert.rejects(guide(h).props.onProgress('complete'),/write unavailable/);
  assert.equal(guide(h).props.page,'compute');assert.equal(shell(h).props.inert,true);
 }finally{h.unmount();}
 const existing=fixture('complete');try{await existing.flush();assert.throws(()=>guide(existing));help(existing);}finally{existing.unmount();}
});
test('SSH authentication is handed to the existing terminal and its setup page remains available',async()=>{
 const h=fixture('compute');try{
  await h.flush();guide(h).props.onConnect('ssh');await h.flush();
  const chooser=h.find(n=>n.type==='./ComputeConnectionChooser');assert.equal(chooser.props.preferredKind,'ssh');
  chooser.props.onSsh({kind:'ssh',id:'saved-example',version:3,name:'Example',mode:'interactive'});await h.flush();
  assert.equal(shell(h).props.inert,undefined);
  const terminal=h.find(n=>n.type==='./SharedTerminalPanel');
  assert.equal(terminal.props.request.profileId,'saved-example');assert.equal(terminal.props.request.version,3);
  const bubble=h.find(n=>n.type==='./SetupLesson');
  assert.equal(bubble.props.lesson.destination,'ssh-login');assert.throws(()=>help(h));
  bubble.props.onReturn();await h.flush();assert.equal(guide(h).props.page,'compute');
  assert.ok(!h.calls.some(c=>c.method==='compute.sshService.connect'||c.method==='task.execute'));
 }finally{h.unmount();}
});

test('setting a new default preserves the open chat and its draft; the setup test starts in the chosen provider',async()=>{
 const h=agentHarness();try{
  await h.flush();h.render({sessionSelection:{nonce:'existing',conversation:conversation('codex','example')}});await h.flush();
  h.type('Keep this draft');const start=h.calls.length;
  h.render({setupProviderChoice:{nonce:'choice',provider:'qwen'}});await h.flush();
  assert.equal(h.textarea().props.value,'Keep this draft');
  assert.equal(h.find(node=>node.props?.['data-testid']==='agent-provider').props.value,'codex');
  assert.ok(!h.calls.slice(start).some(c=>c.method==='agent.disconnect'));
  h.render({sessionSelection:{nonce:'test',new:true,provider:'qwen',initialPrompt:'Reply OK'}});await h.flush();
  assert.equal(h.find(node=>node.props?.['data-testid']==='agent-provider').props.value,'qwen');
  assert.equal(h.textarea().props.value,'Reply OK');assert.ok(!h.calls.slice(start).some(c=>c.data?.method==='turn/start'));
 }finally{h.unmount();}
});

test('a failed conversation handoff keeps the lesson and a successful handoff retains the selected check',async()=>{
 const h=fixture('ready');try{
  await h.flush();await guide(h).props.onVisit('short-check','pydyn-md');await h.flush();
  const bubble=h.find(n=>n.type==='./SetupLesson');assert.deepEqual(bubble.props.lesson,{destination:'short-check',shortCase:'pydyn-md'});
  assert.equal(shell(h).props.inert,undefined);bubble.props.onReturn();await h.flush();
  assert.equal(shell(h).props.inert,true);assert.equal(guide(h).props.page,'ready');
 }finally{h.unmount();}
 const failed=appWorkerHarness({override:async(method,data,standard)=>{
  if(method==='state')return {...await standard(method,data),setupGuide:{page:'agent',directory:'workspace',directoryKind:'workspace'}};
  if(method==='conversation.select')throw Error('Chat unavailable');
  return standard(method,data);
 }});try{
  await failed.flush();await guide(failed).props.onVisit('model-test');await failed.flush();
  assert.equal(shell(failed).props.inert,true);assert.throws(()=>failed.find(n=>n.type==='./SetupLesson'));
 }finally{failed.unmount();}
});
