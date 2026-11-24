import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskRecords as WorkspaceTaskRecords} from "../../backend/main/workspace/task-records.mjs";
import {graphAuthorityFacts} from "../../backend/main/workspace/composition-authority.mjs";
import {formatPreparedTaskTurn,formatGraphAuthorityContext} from "../../agent/context/task-turn-context.mjs";
import {TaskRecords} from "../../agent/sessions/task-records.mjs";

function fixture(Records=WorkspaceTaskRecords){
 const rows=new Map(),events=[];
 const catalog={
  get:(kind,id)=>structuredClone(rows.get(kind+':'+id)),
  put:(kind,id,value)=>{rows.set(kind+':'+id,structuredClone(value));return value;},
  list:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>structuredClone(value))
 };
 return {rows,events,records:new Records(catalog,event=>events.push(structuredClone(event)))};
}

function workflow(records){
 const task=records.create({provider:'codex',threadId:'owned-thread',planningMode:true,workflowVersion:2,request:'Synthetic graph review'});
 task.parameters={engine:'pygas.build',files:['/fixture/build.py'],bias:{temp:300}};
 task.steps=[{id:'bias',title:'Bias',fields:[{key:'bias.temp',label:'Temperature',type:'number',required:true}]}];
 task.authoring={
  projectId:'owned-project',environmentId:'owned-environment',inputRoot:'/fixture',
  unrelatedPrivate:'must-not-enter-the-model-snapshot',
  compositionAuthority:{origin:'human',parameterRevision:0,graphSha:'a'.repeat(64),sourceSha:'b'.repeat(64),graph:{nodes:[],settings:{cutoff:3}},fields:[{key:'bias.temp',targets:[],value:300}]}
 };
 task.inputBinding={parameters:{temperature:300,cv:{atoms_zero_based:[[0,1,2,3]]},evidence:{hashes:['fixture-evidence']}}};
 return records.save(task);
}

test('Workspace preparation owns binding and review state, returning only isolated facts',()=>{
 const {records,rows,events}=fixture(),task=workflow(records);
 const prepared=records.prepareTurnState('codex',{threadId:'owned-thread',studioTaskId:task.id,planningMode:true,reviewMode:true,model:'fixture-model',input:[{type:'text',text:'Review these inputs'}]});
 assert.deepEqual(Object.keys(prepared).sort(),['interaction','params']);
 assert.equal(prepared.params.model,'fixture-model');
 for(const key of ['planningMode','reviewMode','studioTaskId'])assert(!Object.hasOwn(prepared.params,key));
 assert.equal(records.active.get('codex:owned-thread'),task.id);
 assert.deepEqual(records.turns.get('codex:owned-thread'),{taskId:task.id,revision:0,reviewMode:true,presented:false});
 assert.equal(records.read(task.id).review.status,'reviewing');
 assert.equal(prepared.interaction.workflow.id,task.id);
 assert(!Object.hasOwn(prepared.interaction.workflow,'authoring'));
 assert(!JSON.stringify(prepared.interaction).includes('must-not-enter-the-model-snapshot'));
 assert.deepEqual(prepared.interaction.workflow.inputBinding.parameters,{temperature:300,atom_selection:[[0,1,2,3]]});
 const beforeRows=structuredClone(rows),beforeEvents=structuredClone(events),beforePrepared=structuredClone(prepared);
 const output=formatPreparedTaskTurn(prepared);
 assert.match(output.input.at(-1).text,/mode: review/);
 assert(output.input.at(-1).text.includes(task.id));
 assert(output.input.at(-1).text.includes('Review science only.'));
 assert.deepEqual(rows,beforeRows);
 assert.deepEqual(events,beforeEvents);
 assert.deepEqual(prepared,beforePrepared);
 prepared.interaction.workflow.parameters.bias.temp=900;
 prepared.interaction.workflow.graphAuthority.authority.graph.settings.cutoff=99;
 assert.equal(records.read(task.id).parameters.bias.temp,300);
 assert.equal(records.read(task.id).authoring.compositionAuthority.graph.settings.cutoff,3);
});

test('A prepared snapshot stays stable while later manual changes survive stale review results',()=>{
 const {records}=fixture(),task=workflow(records);
 const prepared=records.prepareTurnState('codex',{threadId:'owned-thread',studioTaskId:task.id,reviewMode:true});
 records.edit({id:task.id,changes:{'bias.temp':345}});
 assert.equal(prepared.interaction.workflow.parameters.bias.temp,300);
 const graphFacts=prepared.interaction.workflow.graphAuthority;
 assert.equal(graphFacts.authority.currentGraphOwnedMirrors[0].value,300);
 const text=formatPreparedTaskTurn(prepared).input.at(-1).text;
 assert(text.includes('"parameters":{"engine":"pygas.build","files":["/fixture/build.py"],"bias":{"temp":300}}'));
 records.event({provider:'codex',method:'item/completed',params:{threadId:'owned-thread',item:{result:{kind:'task-parameters',id:task.id,name:'Stale proposal',steps:task.steps,parameters:{...task.parameters,bias:{temp:290}},missing_fields:[]}}}});
 records.event({provider:'codex',method:'turn/completed',params:{threadId:'owned-thread',turn:{status:'completed'}}});
 assert.equal(records.read(task.id).parameters.bias.temp,345);
 assert.equal(records.read(task.id).review.status,'stale');
});

test('Legacy TaskRecords facade uses workspace state and keeps ordinary chat side-effect free',()=>{
 const {records,rows,events}=fixture(TaskRecords);
 assert(records instanceof WorkspaceTaskRecords);
 const input=[{type:'text',text:'Public connection help'}];
 const turn=records.prepareTurn('codex',{threadId:'chat',input,planningMode:false});
 assert.equal(turn.input[0],input[0]);
 assert.equal(turn.input.length,2);
 assert.match(turn.input[1].text,/mode: chat/);
 assert.equal(input.length,1);
 assert.equal(rows.size,0);
 assert.deepEqual(events,[]);
 const task=workflow(records);
 const planned=records.prepareTurn('codex',{threadId:'owned-thread',studioTaskId:task.id,planningMode:true,input});
 assert.match(planned.input.at(-1).text,/mode: planning/);
 assert.equal(records.active.get('codex:owned-thread'),task.id);
 assert.equal(records.turns.get('codex:owned-thread').taskId,task.id);
});

test('Graph fact projection and formatting preserve saved versus partial authority without mutation',()=>{
 const task={parameterRevision:3,parameters:{bias:{temp:310}},authoring:{compositionAuthority:{origin:'human',parameterRevision:2,graphSha:'a'.repeat(64),sourceSha:'b'.repeat(64),graph:{nodes:[]},fields:[{key:'bias.temp'}]}}};
 const facts=graphAuthorityFacts(task),before=structuredClone(task);
 assert.equal(facts.kind,'saved');
 assert.deepEqual(facts.authority.currentGraphOwnedMirrors,[{key:'bias.temp',value:310}]);
 const saved=formatGraphAuthorityContext(facts);
 assert(saved.includes('"graph_sha256":"'+'a'.repeat(64)+'"'));
 assert(saved.includes('"currentGraphOwnedMirrors":[{"key":"bias.temp","value":310}]'));
 assert.deepEqual(task,before);
 delete task.authoring.compositionAuthority;
 task.authoring.compositionIntent={mode:'metad',temperature:null};
 const partial=graphAuthorityFacts(task);
 task.authoring.compositionIntent.temperature=400;
 assert.equal(partial.kind,'partial');
 assert.deepEqual(partial.intent,{mode:'metad',temperature:null});
 assert(formatGraphAuthorityContext(partial).includes('"temperature":null'));
 assert.equal(formatGraphAuthorityContext(null),'');
});

test('Fact preparation rejects invalid ownership or modes before changing stored state',()=>{
 const {records,rows,events}=fixture(),task=workflow(records),beforeRows=structuredClone(rows),beforeEvents=structuredClone(events);
 for(const [provider,value] of [
  ['qwen',{threadId:'owned-thread',studioTaskId:task.id,planningMode:true}],
  ['codex',{threadId:'other-thread',studioTaskId:task.id,planningMode:true}],
  ['codex',{threadId:'owned-thread',planningMode:'true'}],
  ['codex',{threadId:'unbound',planningMode:true}],
  ['codex',{threadId:'unbound',reviewMode:true}]
 ])assert.throws(()=>records.prepareTurnState(provider,value));
 assert.deepEqual(rows,beforeRows);
 assert.deepEqual(events,beforeEvents);
});

test('Incremental workflow turn context omits repeated JSON when unchanged and resends full authority on edit, review, compaction or failure',()=>{
 const {records}=fixture(),task=workflow(records);
 const first=records.prepareTurnState('codex',{threadId:'owned-thread',planningMode:false,input:[{type:'text',text:'First question'}]});
 assert.equal(first.interaction.contextBaseline,undefined);
 const firstText=formatPreparedTaskTurn(first).input.at(-1).text;
 assert(firstText.includes('Manual current parameters and revision:'));
 records.confirmTurnContext('codex','owned-thread');

 const second=records.prepareTurnState('codex',{threadId:'owned-thread',planningMode:false,input:[{type:'text',text:'Follow-up question'}]});
 assert.equal(second.interaction.contextBaseline?.unchanged,true);
 const secondText=formatPreparedTaskTurn(second).input.at(-1).text;
 assert(secondText.includes('Workflow state is unchanged since the previous confirmed turn'));
 assert(!secondText.includes('Manual current parameters and revision:'));
 assert(secondText.length<firstText.length);

 const review=records.prepareTurnState('codex',{threadId:'owned-thread',reviewMode:true,input:[{type:'text',text:'Review'}]});
 assert.equal(review.interaction.contextBaseline,undefined);
 assert(formatPreparedTaskTurn(review).input.at(-1).text.includes('Manual current parameters and revision:'));

 records.confirmTurnContext('codex','owned-thread');
 records.edit({id:task.id,changes:{'bias.temp':350}});
 const afterEdit=records.prepareTurnState('codex',{threadId:'owned-thread',planningMode:false,input:[{type:'text',text:'After edit'}]});
 assert.equal(afterEdit.interaction.contextBaseline,undefined);
 assert(formatPreparedTaskTurn(afterEdit).input.at(-1).text.includes('"temp":350'));

 records.confirmTurnContext('codex','owned-thread');
 records.event({provider:'codex',method:'thread/compacted',params:{threadId:'owned-thread'}});
 const afterCompact=records.prepareTurnState('codex',{threadId:'owned-thread',planningMode:false,input:[{type:'text',text:'After compact'}]});
 assert.equal(afterCompact.interaction.contextBaseline,undefined);

 records.confirmTurnContext('codex','owned-thread');
 records.failedTurn('codex','owned-thread',Error('network error'));
 const afterFail=records.prepareTurnState('codex',{threadId:'owned-thread',planningMode:false,input:[{type:'text',text:'After fail'}]});
 assert.equal(afterFail.interaction.contextBaseline,undefined);
});
