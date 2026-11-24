import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,conversation,memoryStorage} from '../helpers/agent-hooks.mjs';
import {createReadingPositions,readingKey} from '../../frontend/features/conversations/reading-position.mjs';
import {boundJobConversation,createJobConversationLookup} from '../../frontend/app/workspace-shell.mjs';

const treeNodes=node=>Array.isArray(node)?node.flatMap(treeNodes):node&&typeof node==='object'?[node,...treeNodes(node.props?.children)]:[];

test('collapsed tool groups hoist workflow and run CTAs and error groups auto-open with manual toggle override',async()=>{
 const opened=[];
 const h=agentHarness({
  props:{
   sessionSelection:{nonce:'tools',conversation:conversation('codex','t1')},
   onOpenTask:id=>opened.push(['workflow',id]),
   onOpenRun:id=>opened.push(['run',id]),
  },
 });
 try{
  await h.flush();
  h.emit({provider:'codex',method:'item/completed',params:{threadId:'t1',item:{id:'call-1',type:'mcpToolCall',tool:'present_task',status:'completed',result:{content:[{type:'text',text:JSON.stringify({id:'wf-1',kind:'task-parameters',name:'Flow'})}]}}}});
  h.emit({provider:'codex',method:'item/completed',params:{threadId:'t1',item:{id:'call-2',type:'mcpToolCall',tool:'prepare_run',status:'completed',result:{content:[{type:'text',text:JSON.stringify({id:'run-1',engine:'gpumd.md'})}]}}}});
  await h.flush();
  const scroll=()=>treeNodes(h.find(node=>node.props?.className==='chat-scroll'));
  const group=()=>scroll().find(node=>node.props?.['data-testid']==='tool-group');
  assert.equal(group().props.open,undefined,'completed group stays collapsed by default');
  const openWorkflow=scroll().find(node=>node.props?.['data-testid']==='tool-group-open-workflow');
  const openRun=scroll().find(node=>node.props?.['data-testid']==='tool-group-open-run');
  openWorkflow.props.onClick();
  openRun.props.onClick();
  assert.deepEqual(opened,[['workflow','wf-1'],['run','run-1']]);

  h.emit({provider:'codex',method:'item/completed',params:{threadId:'t1',item:{id:'call-err',type:'mcpToolCall',tool:'probe_environment',status:'failed',error:{message:'runtime missing'}}}});
  await h.flush();
  assert.equal(group().props.open,true,'error severity auto-opens tool group');
  group().props.onToggle({currentTarget:{open:false}});
  await h.flush();
  assert.equal(group().props.open,false,'user can manually collapse an auto-opened error group');
 }finally{h.unmount();}
});

test('reading positions skip DOM anchor queries and repeated storage writes while following latest messages',()=>{
 const storage=memoryStorage();
 let setCalls=0,domQueries=0;
 const tracked={getItem:k=>storage.getItem(k),removeItem:k=>storage.removeItem(k),setItem:(k,v)=>{setCalls++;storage.setItem(k,v);}};
 const positions=createReadingPositions(()=>tracked),key=readingKey('codex','stream');
 const node={scrollTop:1200,scrollHeight:1600,getBoundingClientRect:()=>{domQueries++;return {top:0};},querySelectorAll:()=>{domQueries++;return [];},scrollTo({top}){this.scrollTop=top;}};
 positions.save(key,node,true);
 assert.equal(domQueries,0);
 assert.equal(setCalls,1);
 node.scrollTop=1400;
 positions.save(key,node,true);
 node.scrollTop=1600;
 positions.save(key,node,true);
 assert.equal(domQueries,0);
 assert.equal(setCalls,1,'subsequent follow=true saves skip redundant localStorage writes');
});

test('indexed job-conversation lookup matches boundJobConversation across local, cluster, source-scoped and ambiguous bindings',()=>{
 const tasks=[
  {id:'t1',provider:'codex',threadId:'th1',workerSourceId:'src-a',artifacts:[{id:'r1',kind:'run'},{id:'c1',kind:'cluster-run'}]},
  {id:'t2',provider:'deepseek',threadId:'th2',artifacts:[{id:'r2',kind:'run'}]},
  {id:'t3',provider:'codex',threadId:'th3',workerSourceId:'src-a',artifacts:[{id:'dup',kind:'run'}]},
  {id:'t4',provider:'kimi',threadId:'th4',workerSourceId:'src-a',artifacts:[{id:'dup',kind:'run'}]},
 ];
 const conversations=[
  {id:'codex:th1',provider:'codex',threadId:'th1',taskId:'t1',name:'C1'},
  {id:'deepseek:th2',provider:'deepseek',threadId:'th2',taskId:'t2',name:'C2'},
  {id:'codex:th3',provider:'codex',threadId:'th3',taskId:'t3',name:'C3'},
  {id:'kimi:th4',provider:'kimi',threadId:'th4',taskId:'t4',name:'C4'},
 ];
 const lookup=createJobConversationLookup(tasks,conversations);
 const cases=[
  [{location:'local',run:{id:'r1'}},'src-a'],
  [{location:'local',run:{id:'r1'}},'src-b'],
  [{location:'cluster',run:{id:'c1'}},'src-a'],
  [{location:'local',run:{id:'r2'}},undefined],
  [{location:'local',run:{id:'dup'}},'src-a'],
 ];
 for(const [job,sourceId] of cases){
  assert.deepEqual(lookup(job,sourceId),boundJobConversation(job,tasks,conversations,sourceId));
 }
});
