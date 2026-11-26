import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowExperienceEnvironment,deferred} from '../helpers/workflow-experience-components.mjs';
import {buildStage,consumerStage,privateCv,taskComposition,workflowTask} from '../fixtures/frontend-workflow-experience.mjs';
const workflow='frontend/features/workflows/Workflows.tsx',build='frontend/features/workflows/TaskStageEditor.tsx',consumer='frontend/features/workflows/ConsumerStageEditor.tsx',custom='frontend/features/custom-cv/CustomCvWorkbench.tsx';
const composer='frontend/features/pygas/PygasTaskComposer.tsx',page='frontend/features/workflows/AgentTaskPage.tsx';
const sessionStore=env=>env.load('frontend/ui/session-drafts.ts');
const stageStore=env=>env.load('frontend/features/workflows/stage-editor-draft.ts');
function mountPlan(env,props={}){return env.mount(workflow,{taskId:'sampling',onSaved(){},onAgent(){},onError:error=>{throw error;},onTool(){},...props},'WorkflowPage');}
function mountPage(env,task=workflowTask(),props={}){return env.mount(page,{task,worker:true,environments:[],theme:'dark',onError:error=>{throw error;},onRun(){},onCluster(){},onSetup(){},onReview(){},onRefresh(){},onAgent(){},onReplace(){},onDeploy(){},...props});}
async function readyPage(h){await h.flush();h.find(node=>node.type?.name==='PygasTaskComposer').props.onStateChange({loading:false,dirty:false,saving:false,error:false,renderBlocked:false,savedGraphMode:'metad'});await h.flush();}

test('plan acknowledgement preserves newer text, attaches the saved identity and does not hand it to Agent',async()=>{
 const pending=deferred(),calls=[],saved=[],agent=[],env=workflowExperienceEnvironment(async(method,value)=>{calls.push({method,value});return pending.promise;});const h=mountPlan(env,{onSaved:(...args)=>saved.push(args),onAgent:value=>agent.push(value)});await h.flush();
 h.find(node=>node.type==='input'&&node.props.type===undefined).props.onChange({target:{value:'first'}});await h.flush();h.button('交给 Agent 准备').props.onClick();await h.flush();h.find(node=>node.type==='input'&&node.props.type===undefined).props.onChange({target:{value:'newer'}});await h.flush();pending.resolve({...calls[0].value,id:'saved-plan'});await h.flush();
 assert.equal(h.find(node=>node.type==='input'&&node.props.type===undefined).props.value,'newer');assert.equal(saved[0][1].navigate,false);assert.deepEqual(agent,[]);assert.match(h.text(h.id('workflow-plan')),/继续输入的修改仍待保存/);h.unmount();const reopened=mountPlan(env,{initial:saved[0][0],onSaved:(...args)=>saved.push(args),onAgent:value=>agent.push(value)});await reopened.flush();assert.equal(reopened.find(node=>node.type==='input'&&node.props.type===undefined).props.value,'newer');reopened.button('保存任务计划').props.onClick();await reopened.flush();assert.equal(calls[1].value.id,'saved-plan');assert.equal(calls[1].value.name,'newer');reopened.unmount();
});
test('unmounted plan save acknowledges its record without navigation or Agent handoff',async()=>{
 const pending=deferred(),saved=[],agent=[],env=workflowExperienceEnvironment(()=>pending.promise),h=mountPlan(env,{onSaved:(...args)=>saved.push(args),onAgent:value=>agent.push(value)});await h.flush();h.button('交给 Agent 准备').props.onClick();await h.flush();h.unmount();pending.resolve({id:'saved',taskId:'sampling'});await h.flush();assert.equal(saved[0][1].navigate,false);assert.deepEqual(agent,[]);
});
test('build stage retains edits across connection and task changes, and requires fresh source reconciliation',async()=>{
 const env=workflowExperienceEnvironment();let revision=1;const props={taskId:'task-A',revision,workerReady:true,api:{inspect:async({taskId})=>buildStage(taskId,revision),save:async()=>{throw Error('not authorized in fixture');}},onSaved(){}};const h=env.mount(build,props);await h.flush();h.id('stage-inspect').props.onClick();await h.flush();h.find(node=>node.type==='ParameterFields'&&node.props.fields[0].key==='cutoff').props.onChange('cutoff',4.7);await h.flush();h.props({workerReady:false});await h.flush();assert.equal(h.find(node=>node.type==='ParameterFields'&&node.props.fields[0].key==='cutoff').props.parameters.cutoff,4.7);assert.equal(h.id('stage-save').props.disabled,true);
 revision=2;h.props({workerReady:true,revision});await h.flush();h.id('stage-inspect').props.onClick();await h.flush();h.id('stage-draft-conflict');assert.equal(h.id('stage-save').props.disabled,true);h.button('已核对，采用新来源并保留可编辑项').props.onClick();await h.flush();assert.equal(h.id('stage-save').props.disabled,false);assert.equal(h.find(node=>node.type==='ParameterFields'&&node.props.fields[0].key==='cv_definition').props.parameters.cv_definition,'saved definition 2');h.props({taskId:'task-B'});await h.flush();assert(!h.nodes().some(node=>node.props?.['data-testid']==='stage-save'));h.props({taskId:'task-A'});await h.flush();assert.equal(h.find(node=>node.type==='ParameterFields'&&node.props.fields[0].key==='cutoff').props.parameters.cutoff,4.7);assert.equal(h.id('stage-save').props.disabled,true);h.unmount();
});
test('consumer reread rebinds only exact asset identity and preserves values across stage changes',async()=>{
 const env=workflowExperienceEnvironment();let read=0;const proposals=[];const h=env.mount(consumer,{taskId:'task-A',revision:1,workerReady:true,api:{inspect:async({taskId,engine})=>consumerStage(taskId,1,++read,engine),propose:async value=>{proposals.push(value);return {taskId:'task-A',engine:'gpumd.sampling',proposalId:'p',files:[]};}},onSaved(){}});await h.flush();h.find(node=>node.props?.id==='consumer-stage-engine').props.onChange({target:{value:'gpumd.sampling'}});await h.flush();h.id('consumer-stage-inspect').props.onClick();await h.flush();h.find(node=>node.type==='GroupedParameterFields').props.onChange('temperature_K',325);h.find(node=>node.props?.id==='consumer-nep').props.onChange({target:{value:'potential-1'}});await h.flush();h.props({workerReady:false});await h.flush();h.props({workerReady:true});await h.flush();assert.equal(h.id('consumer-stage-preview').props.disabled,true);h.id('consumer-stage-inspect').props.onClick();await h.flush();assert.equal(h.find(node=>node.props?.id==='consumer-nep').props.value,'potential-2');h.id('consumer-stage-preview').props.onClick();await h.flush();assert.equal(proposals[0].values.temperature_K,325);assert.equal(proposals[0].selections.potentialId,'potential-2');h.find(node=>node.props?.id==='consumer-stage-engine').props.onChange({target:{value:'bias.validate'}});await h.flush();h.find(node=>node.props?.id==='consumer-stage-engine').props.onChange({target:{value:'gpumd.sampling'}});await h.flush();assert.equal(h.find(node=>node.type==='GroupedParameterFields').props.parameters.temperature_K,325);assert.equal(h.id('consumer-stage-preview').props.disabled,true);h.unmount();
});
test('unknown stage save retains the submitted draft and requires a reread without retry',async()=>{
 const env=workflowExperienceEnvironment();let saves=0;const h=env.mount(build,{taskId:'unknown',revision:1,workerReady:true,api:{inspect:async()=>buildStage('unknown'),save:async()=>{saves++;throw Error('Connection lost');}},onSaved(){}});await h.flush();h.id('stage-inspect').props.onClick();await h.flush();h.find(node=>node.type==='ParameterFields'&&node.props.fields[0].key==='cutoff').props.onChange('cutoff',5);await h.flush();h.id('stage-save').props.onClick();await h.flush();assert.equal(h.id('stage-save').props.disabled,true);assert.match(h.text(h.id('stage-draft-retained')),/保存结果尚待核对/);assert.equal(saves,1);h.id('stage-inspect').props.onClick();await h.flush();assert.equal(saves,1);h.unmount();
});
const callbacks={onSave(){},onApproveFormula(){},onApproveCode(){},onValidate(){},onAttach(){},onSharing(){},onSelect(){},onDiscuss(){},onReload(){}};
test('private CV unsaved values survive unmount, stay task-isolated and block changed saved versions',async()=>{
 const env=workflowExperienceEnvironment(),props={...privateCv(),...callbacks},a=env.mount(custom,props);await a.flush();a.find(node=>node.props?.label==='custom.parameter.epsilon').props.onChange(.25);await a.flush();a.unmount();const b=env.mount(custom,{...privateCv('task-B','private-A'),...callbacks});await b.flush();assert.equal(b.find(node=>node.props?.label==='custom.parameter.epsilon').props.value,.1);b.unmount();const restored=env.mount(custom,props);await restored.flush();assert.equal(restored.find(node=>node.props?.label==='custom.parameter.epsilon').props.value,.25);restored.props({entry:{...props.entry,expected:{...props.entry.expected,revision:'external'}}});await restored.flush();assert.equal(restored.id('custom-primary').props.disabled,true);assert(restored.nodes().some(node=>node.props?.role==='alert'));restored.unmount();
});
test('private old save completion cannot erase newer edits after navigation',async()=>{
 const env=workflowExperienceEnvironment(),pending=deferred(),props={...privateCv(),...callbacks,onSave:()=>pending.promise},a=env.mount(custom,props);await a.flush();a.find(node=>node.props?.label==='custom.parameter.epsilon').props.onChange(.2);await a.flush();a.id('custom-primary').props.onClick();await a.flush();a.unmount();const b=env.mount(custom,props);await b.flush();b.find(node=>node.props?.label==='custom.parameter.epsilon').props.onChange(.3);await b.flush();pending.resolve();await b.flush();assert.equal(b.find(node=>node.props?.label==='custom.parameter.epsilon').props.value,.3);assert.match(b.text(b.id('custom-primary')),/保存定义与参数/);b.unmount();
});

test('experience-round2 private read reconciles an unknown successful save without repeating any mutation',async()=>{
 const env=workflowExperienceEnvironment(),calls=[],props={...privateCv(),...callbacks};let h,saved=props.entry;
 props.onSave=async(spec,values)=>{calls.push('save');saved={...saved,spec:structuredClone(spec),parameterValues:structuredClone(values),expected:{...saved.expected,revision:'accepted-but-response-lost'}};throw Error('Save response unavailable');};
 props.onReload=async options=>{calls.push({read:options});h.props({entry:saved});return saved;};h=env.mount(custom,props);await h.flush();h.find(node=>node.props?.label==='custom.parameter.epsilon').props.onChange(.4);await h.flush();h.id('custom-primary').props.onClick();await h.flush();assert.equal(h.find(node=>node.props?.label==='custom.parameter.epsilon').props.value,.4);h.id('custom-read-saved').props.onClick();await h.flush();h.id('custom-read-matched');assert.deepEqual(calls,['save',{read:{preserveDraft:true}}]);assert.doesNotMatch(h.text(h.id('custom-primary')),/保存定义与参数/);h.unmount();
});
test('experience-round2 private read error preserves edits and explicit source adoption changes only the draft baseline',async()=>{
 const env=workflowExperienceEnvironment(),calls=[],props={...privateCv(),...callbacks};let h,fail=true,saved={...props.entry,parameterValues:{epsilon:.7},expected:{...props.entry.expected,revision:'agent-edited'}};
 props.onReload=async options=>{calls.push({read:options});if(fail)throw Error('Read unavailable');h.props({entry:saved});return saved;};props.onSave=async(_spec,values,expected)=>{calls.push({save:values,expected});};h=env.mount(custom,props);await h.flush();h.find(node=>node.props?.label==='custom.parameter.epsilon').props.onChange(.3);await h.flush();h.id('custom-read-saved').props.onClick();await h.flush();assert.equal(h.find(node=>node.props?.label==='custom.parameter.epsilon').props.value,.3);assert(h.nodes().some(node=>node.props?.role==='alert'&&h.text(node).includes('Read unavailable')));
 fail=false;h.id('custom-read-saved').props.onClick();await h.flush();h.id('custom-read-different');assert.equal(h.id('custom-primary').props.disabled,true);assert.match(h.text(h.id('custom-draft-reconcile')),/0.7/);assert.match(h.text(h.id('custom-draft-reconcile')),/0.3/);h.id('custom-continue-local').props.onClick();await h.flush();assert.equal(h.id('custom-primary').props.disabled,false);assert.equal(calls.filter(call=>call.save).length,0);h.id('custom-primary').props.onClick();await h.flush();assert.equal(calls.at(-1).expected.revision,'agent-edited');assert.equal(calls.at(-1).save.epsilon,.3);h.unmount();
});
test('experience-round2 explicit saved-version choice discards only this private draft without a write',async()=>{
 const env=workflowExperienceEnvironment(),props={...privateCv(),...callbacks},h=env.mount(custom,props);await h.flush();h.find(node=>node.props?.label==='custom.parameter.epsilon').props.onChange(.3);await h.flush();h.props({entry:{...props.entry,parameterValues:{epsilon:.7},expected:{...props.entry.expected,revision:'new'}}});await h.flush();h.id('custom-use-saved').props.onClick();await h.flush();assert.equal(h.find(node=>node.props?.label==='custom.parameter.epsilon').props.value,.7);assert.doesNotMatch(h.text(h.id('custom-primary')),/保存定义与参数/);h.unmount();
});
test('experience-round2 late matching read cannot clear newer edits made after navigation',async()=>{
 const env=workflowExperienceEnvironment(),gate=deferred(),props={...privateCv(),...callbacks,onReload:()=>gate.promise},a=env.mount(custom,props);await a.flush();a.find(node=>node.props?.label==='custom.parameter.epsilon').props.onChange(.2);await a.flush();a.id('custom-read-saved').props.onClick();await a.flush();a.unmount();const b=env.mount(custom,props);await b.flush();b.find(node=>node.props?.label==='custom.parameter.epsilon').props.onChange(.3);await b.flush();gate.resolve({...props.entry,parameterValues:{epsilon:.2}});await b.flush();assert.equal(b.find(node=>node.props?.label==='custom.parameter.epsilon').props.value,.3);assert.match(b.text(b.id('custom-primary')),/保存定义与参数/);b.unmount();
});
test('experience-round2 controller explicit read preserves dirty state, propagates failure and never mutates',async()=>{
 const env=workflowExperienceEnvironment(),record=privateCv(),calls=[],states=[];let fail=false;const h=env.mount('frontend/features/custom-cv/CustomCvTaskController.tsx',{taskId:record.taskId,entryId:record.entry.id,provider:'codex',workerReady:true,invoke:async(method,payload)=>{calls.push({method,payload});if(fail)throw Error('Read unavailable');return record;},onDiscussion(){},onStateChange:value=>states.push(value)});await h.flush();const workbench=()=>h.find(node=>node.type==='./CustomCvWorkbench');workbench().props.onDraftChange(true);await h.flush();const entry=await workbench().props.onReload({preserveDraft:true});await h.flush();assert.equal(entry.id,record.entry.id);assert.equal(states.at(-1).dirty,true);fail=true;await assert.rejects(workbench().props.onReload({preserveDraft:true}),/Read unavailable/);await h.flush();assert.equal(states.at(-1).dirty,true);assert(calls.every(call=>call.method==='customCv.read'));h.unmount();
});

for(const engine of ['pygas.build','gpumd.sampling'])test(engine+' stage drafts gate their task actions without locking the editor or clean snapshots',async()=>{
 const task=workflowTask(),calls=[],env=workflowExperienceEnvironment(async(method,value)=>{calls.push({method,value});if(method==='task.stage.inspect')return buildStage(value.taskId);if(method==='task.consumerStage.inspect')return consumerStage(value.taskId,1,1,value.engine);if(method==='task.consumerStage.propose')return {taskId:task.id,engine,proposalId:'preview',files:[]};if(method.endsWith('.save'))return {taskId:task.id,status:'draft',review:'not_run',execution:'not_run'};throw Error('Unexpected IPC '+method);});
 const p=mountPage(env,task),isBuild=engine==='pygas.build',childType=isBuild?'./TaskStageEditor':'./ConsumerStageEditor',file=isBuild?build:consumer,inspect=isBuild?'stage-inspect':'consumer-stage-inspect',save=isBuild?'stage-save':'consumer-stage-save',discard=isBuild?'stage-discard':'consumer-stage-discard';await readyPage(p);
 const store=sessionStore(env),key=stageStore(env).stageDraftKey;
 store.writeSessionDraft(key('unrelated','pygas.build'),{inspection:buildStage('unrelated'),dirty:true,values:{cutoff:8}});await p.flush();assert.equal(p.id('review-workflow').props.disabled,false);
 let h=env.mount(file,p.find(node=>node.type===childType).props);await h.flush();if(!isBuild){h.find(node=>node.props?.id==='consumer-stage-engine').props.onChange({target:{value:engine}});await h.flush();}h.id(inspect).props.onClick();await h.flush();await p.flush();assert.equal(p.id('review-workflow').props.disabled,false);h.unmount();
 h=env.mount(file,p.find(node=>node.type===childType).props);await h.flush();h.id(isBuild?'stage-snapshot-stale':'consumer-snapshot-stale');assert.equal(h.id(inspect).props.disabled,false);assert.equal(p.id('review-workflow').props.disabled,false);h.id(inspect).props.onClick();await h.flush();
 const edit=()=>isBuild?h.find(node=>node.type==='ParameterFields'&&node.props.fields[0].key==='cutoff').props.onChange('cutoff',4.7):h.find(node=>node.type==='GroupedParameterFields').props.onChange('temperature_K',325);
 edit();await h.flush();await p.flush();for(const action of ['review-workflow','open-local-review','open-deployment'])assert.equal(p.id(action).props.disabled,true,action);const count=calls.length;p.id('review-workflow').props.onClick();p.id('open-deployment').props.onClick();await p.flush();assert.equal(calls.length,count);p.id('stage-draft-gate');
 h.props(p.find(node=>node.type===childType).props);await h.flush();assert.equal(h.id(inspect).props.disabled,false);if(!isBuild){h.id('consumer-stage-preview').props.onClick();await h.flush();}assert.equal(h.id(save).props.disabled,false);h.id(save).props.onClick();await h.flush();await p.flush();assert.equal(p.id('review-workflow').props.disabled,false);assert.equal(p.id('open-deployment').props.disabled,false);
 h.id(inspect).props.onClick();await h.flush();edit();await h.flush();await p.flush();assert.equal(p.id('review-workflow').props.disabled,true);const saved=calls.filter(call=>call.method.endsWith('.save')).length;h.id(discard).props.onClick();await h.flush();await p.flush();assert.equal(p.id('review-workflow').props.disabled,false);assert.equal(calls.filter(call=>call.method.endsWith('.save')).length,saved);assert(store.readSessionDraft(key('unrelated','pygas.build')));h.unmount();p.unmount();
});

test('discarding an uncertain stage save retains the task gate until a successful reread',async()=>{
 const env=workflowExperienceEnvironment(),p=mountPage(env),h=env.mount(build,{taskId:'task-A',revision:1,workerReady:true,api:{inspect:async()=>buildStage(),save:async()=>{throw Error('Reply lost');}},onSaved(){}});await readyPage(p);await h.flush();h.id('stage-inspect').props.onClick();await h.flush();h.find(node=>node.type==='ParameterFields'&&node.props.fields[0].key==='cutoff').props.onChange('cutoff',7);await h.flush();h.id('stage-save').props.onClick();await h.flush();h.id('stage-discard').props.onClick();await h.flush();await p.flush();assert.equal(p.id('review-workflow').props.disabled,true);assert.match(h.text(h.id('stage-draft-retained')),/保存结果尚待核对/);h.id('stage-inspect').props.onClick();await h.flush();await p.flush();assert.equal(p.id('review-workflow').props.disabled,false);h.unmount();p.unmount();
});

test('a retained stage draft also guards the legacy execute handler until explicitly resolved',async()=>{
 const calls=[],task={...workflowTask(),workflowVersion:1,composition:undefined,customCv:undefined,parameters:{engine:'gpumd.sampling'},artifacts:[{id:'fixture-run',kind:'run',preparedRevision:1}],review:{status:'ready',parameterRevision:1,artifactIds:['fixture-run']}},env=workflowExperienceEnvironment(async(method,value)=>{calls.push({method,value});if(method==='worker.request'||method==='task.execute')return {id:'fixture-run',status:'ready',engine:'gpumd.sampling'};throw Error(method);}),p=mountPage(env,task);await p.flush();assert.equal(p.id('execute-workflow').props.disabled,false);
 const store=sessionStore(env),key=stageStore(env).stageDraftKey(task.id,'pygas.build');store.writeSessionDraft(key,{inspection:buildStage(),dirty:true});await p.flush();assert.equal(p.id('execute-workflow').props.disabled,true);p.id('execute-workflow').props.onClick();await p.flush();assert.equal(calls.filter(call=>call.method==='task.execute').length,0);store.clearSessionDraft(key);await p.flush();assert.equal(p.id('execute-workflow').props.disabled,false);p.id('execute-workflow').props.onClick();await p.flush();assert.equal(calls.filter(call=>call.method==='task.execute').length,1);p.unmount();
});

test('plan discard restores the saved record and removes its retained draft without IPC',async()=>{
 const env=workflowExperienceEnvironment(),initial={...env.load('frontend/features/workflows/workflow-catalog.mjs').createPlan('sampling'),id:'saved-plan',name:'Saved name'};const h=mountPlan(env,{initial});await h.flush();h.find(node=>node.type==='input'&&node.props.type===undefined).props.onChange({target:{value:'Local name'}});await h.flush();h.id('plan-discard').props.onClick();await h.flush();assert.equal(h.find(node=>node.type==='input'&&node.props.type===undefined).props.value,'Saved name');assert.equal(h.id('plan-discard').props.disabled,true);h.unmount();const reopened=mountPlan(env,{initial});await reopened.flush();assert.equal(reopened.find(node=>node.type==='input'&&node.props.type===undefined).props.value,'Saved name');reopened.unmount();
});

test('the plan discard toast restores the exact local draft through Undo without IPC',async()=>{
 const env=workflowExperienceEnvironment(),plan=env.load('frontend/features/workflows/workflow-catalog.mjs').createPlan('sampling');
 const original={...plan,id:'saved-plan',name:'Saved plan'};
 const h=mountPlan(env,{initial:original});
 const name=()=>h.find(node=>node.type==='input'&&node.props.type===undefined);
 await h.flush();
 name().props.onChange({target:{value:'Edited name'}});
 await h.flush();
 h.find(node=>node.type==='textarea'&&node.props.rows===3).props.onChange({target:{value:'Keep these recovery notes'}});
 await h.flush();
 // Prompt state and draft storage stay local throughout discard and restoration.
 const drafted=sessionStore(env).readSessionDraft(JSON.stringify(['workflow-plan','sampling',original.id]));
 h.id('plan-discard').props.onClick();await h.flush();
 assert.equal(name().props.value,'Saved plan');
 const undo=env.toasts.at(-1);
 assert.equal(undo.testId,'workflow-plan-discarded');
 assert.equal(undo.duration,8000);
 assert.equal(undo.action.label,'撤销');
 undo.action.onClick();await h.flush();
 assert.deepEqual(sessionStore(env).readSessionDraft(JSON.stringify(['workflow-plan','sampling',original.id])).value,drafted.value);
 assert.equal(name().props.value,'Edited name');
 assert.equal(env.toasts.at(-1).severity,'success');
 h.unmount();
});

test('an older plan discard cannot overwrite newer input or restore over a different editor',async()=>{
 const env=workflowExperienceEnvironment(),base=env.load('frontend/features/workflows/workflow-catalog.mjs').createPlan('sampling');
 const h=mountPlan(env,{initial:{...base,id:'plan-a',name:'Plan A'}});
 const name=()=>h.find(node=>node.type==='input'&&node.props.type===undefined);
 const edit=async value=>{name().props.onChange({target:{value}});await h.flush();};
 const discard=async()=>{h.id('plan-discard').props.onClick();await h.flush();return env.toasts.at(-1).action.onClick;};
 await h.flush();await edit('First discarded revision');
 const older=await discard();
 await edit('Newer local input');older();await h.flush();
 assert.equal(name().props.value,'Newer local input');
 assert(env.dismissedToasts.has(1));
 const newer=await discard();
 older();await h.flush();assert.equal(name().props.value,'Plan A');
 newer();await h.flush();assert.equal(name().props.value,'Newer local input');
 const stale=await discard();
 h.unmount();
 const other=mountPlan(env,{initial:{...base,id:'plan-b',name:'Plan B'}});
 await other.flush();stale();await other.flush();
 assert.equal(other.find(node=>node.type==='input'&&node.props.type===undefined).props.value,'Plan B');
 assert.equal(sessionStore(env).readSessionDraft(JSON.stringify(['workflow-plan','sampling','plan-a'])),undefined);
 other.unmount();
});

test('a saved plan and its temporary navigation alias restore together unless one was edited since discard',async()=>{
 const env=workflowExperienceEnvironment(),store=sessionStore(env),base=env.load('frontend/features/workflows/workflow-catalog.mjs').createPlan('sampling');
 const pending={...base,id:'a-saved-id',name:'Original local edits'};
 const seed=JSON.stringify(['workflow-plan','sampling','new']),saved=JSON.stringify(['workflow-plan','sampling',pending.id]);
 store.writeSessionDraft(seed,pending);store.writeSessionDraft(saved,pending);
 const h=mountPlan(env);
 await h.flush();h.id('plan-discard').props.onClick();await h.flush();
 assert.equal(store.readSessionDraft(seed),undefined);assert.equal(store.readSessionDraft(saved),undefined);
 env.toasts.at(-1).action.onClick();await h.flush();
 assert.deepEqual(store.readSessionDraft(seed).value,pending);assert.deepEqual(store.readSessionDraft(saved).value,pending);
 h.id('plan-discard').props.onClick();await h.flush();
 const stale=env.toasts.at(-1).action.onClick;
 const other=store.writeSessionDraft(seed,{...base,name:'Newer input from another entry'});
 store.clearSessionDraft(seed,other.version);
 stale();await h.flush();
 assert.equal(store.readSessionDraft(seed),undefined);assert.equal(store.readSessionDraft(saved),undefined);
 assert.equal(env.toasts.at(-1).severity,'info');
 h.unmount();
});

test('private library drafts remain discoverable without blocking an unrelated attached definition',async()=>{
 const task=workflowTask(),states=[],calls=[],env=workflowExperienceEnvironment(async method=>{calls.push(method);if(method==='task.pygas.read')return taskComposition();throw Error(method);}),draft=env.mount(custom,{...privateCv('task-A','private-B'),...callbacks});await draft.flush();draft.find(node=>node.props?.label==='custom.parameter.epsilon').props.onChange(.4);await draft.flush();draft.unmount();
 const props={task,worker:true,onStateChange:value=>states.push(value),onSaved(){},onError:error=>{throw error;},onDiscussion(){},customCvInvoke:async()=>{},customProvider:'codex',onCustomDiscussion(){}};const h=env.mount(composer,props);await h.flush();assert.equal(states.at(-1).dirty,false);h.id('custom-draft-list');const cv=env.load('frontend/features/custom-cv/custom-cv-drafts.ts'),store=sessionStore(env),attached=privateCv().entry;store.writeSessionDraft(cv.customCvDraftKey(task.id,attached.id),{spec:attached.spec,values:{epsilon:.7},base:attached.expected});await h.flush();assert.equal(states.at(-1).dirty,true,'The attached definition still blocks even when another library entry is selected');store.clearSessionDraft(cv.customCvDraftKey(task.id,attached.id));await h.flush();assert.equal(states.at(-1).dirty,false);h.find(node=>node.props?.['data-draft-id']==='private-B').props.onClick();await h.flush();const controller=h.find(node=>node.type==='../custom-cv/CustomCvTaskController');controller.props.onStateChange({loading:false,busy:false,dirty:true,error:false});await h.flush();assert.equal(h.button('返回当前组合图').props.disabled,false);h.button('返回当前组合图').props.onClick();await h.flush();assert.equal(states.at(-1).dirty,false);h.id('custom-draft-list');
 h.props({task:{...task,customCv:undefined}});await h.flush();assert.equal(states.at(-1).dirty,true,'An unattached pending definition must still be handled before review');h.unmount();assert(calls.every(method=>method==='task.pygas.read'));
 const reads=[],c=env.mount('frontend/features/custom-cv/CustomCvTaskController.tsx',{taskId:task.id,entryId:'private-A',provider:'codex',invoke:async(method,value)=>{reads.push({method,value});return privateCv(value.taskId,value.id);},onDiscussion(){}});await c.flush();assert.equal(reads[0].value.id,'private-B');assert.equal(c.find(node=>node.type==='./CustomCvWorkbench').props.entry.id,'private-B');c.unmount();
});

test('confirmed task deletion clears only its owned drafts and ignores delayed repopulation',()=>{
 const env=workflowExperienceEnvironment(),store=sessionStore(env),keys=stageStore(env),cv=env.load('frontend/features/custom-cv/custom-cv-drafts.ts'),graphs=env.load('frontend/features/pygas/pygas-local-draft.ts'),clear=env.load('frontend/features/workflows/task-drafts.ts').clearTaskDrafts;
 for(const id of ['task-A','task-B']){store.writeSessionDraft(keys.stageDraftKey(id,'pygas.build'),{inspection:buildStage(id),dirty:true});store.writeSessionDraft(cv.customCvDraftKey(id,'private'),{spec:{name:id}});store.writeSessionDraft(cv.customCvChoiceKey(id),'private');const data=taskComposition(id);graphs.retainDraft(data,data.graph,null);}
 const plan=JSON.stringify(['workflow-plan','sampling','saved']);store.writeSessionDraft(plan,{name:'Independent plan'});clear('task-A');const late=taskComposition();store.writeSessionDraft(keys.stageDraftKey('task-A','pygas.build'),{inspection:buildStage(),dirty:true});store.writeSessionDraft(cv.customCvDraftKey('task-A','private'),{spec:{name:'late'}});graphs.retainDraft(late,late.graph,null);
 assert.equal(store.readSessionDraft(keys.stageDraftKey('task-A','pygas.build')),undefined);assert.equal(store.readSessionDraft(cv.customCvDraftKey('task-A','private')),undefined);assert.equal(graphs.readDraft(late),null);assert.equal(graphs.isTaskPygasDirty('task-A'),false);assert(store.readSessionDraft(keys.stageDraftKey('task-B','pygas.build')));assert(graphs.isTaskPygasDirty('task-B'));assert(store.readSessionDraft(plan));assert(Object.keys(env.storage).every(key=>!key.startsWith('studio.pygas.draft.v1:task-A:')));
});

for(const change of ['graph-mode','graph-status','removed-cv'])test('a '+change+' change leaves a visible recovery editor for retained stage input',async()=>{
 const isBuild=change!=='removed-cv',task=workflowTask(),env=workflowExperienceEnvironment(),p=mountPage(env,task),childType=isBuild?'./TaskStageEditor':'./ConsumerStageEditor';await readyPage(p);const child=()=>p.find(node=>node.type===childType),api={inspect:async()=>isBuild?buildStage():consumerStage()},file=isBuild?build:consumer;const h=env.mount(file,{...child().props,api});await h.flush();if(!isBuild){h.find(node=>node.props?.id==='consumer-stage-engine').props.onChange({target:{value:'gpumd.sampling'}});await h.flush();}h.id(isBuild?'stage-inspect':'consumer-stage-inspect').props.onClick();await h.flush();if(isBuild)h.find(node=>node.type==='ParameterFields'&&node.props.fields[0].key==='cutoff').props.onChange('cutoff',6);else h.find(node=>node.type==='GroupedParameterFields').props.onChange('temperature_K',360);await h.flush();await p.flush();
 if(change==='graph-mode')p.find(node=>node.type?.name==='PygasTaskComposer').props.onStateChange({loading:false,dirty:false,saving:false,error:false,renderBlocked:false,savedGraphMode:'opes'});else p.props({task:change==='graph-status'?{...task,composition:{...task.composition,status:'blocked'}}:{...task,customCv:undefined}});await p.flush();assert.equal(child().props.recoveryOnly,true);h.props({...child().props,api});await h.flush();h.id(isBuild?'stage-recovery-only':'consumer-recovery-only');assert.equal(h.id(isBuild?'stage-save':'consumer-stage-preview').props.disabled,true);assert.equal(h.id(isBuild?'stage-inspect':'consumer-stage-inspect').props.disabled,false);assert.equal(p.id('review-workflow').props.disabled,true);h.id(isBuild?'stage-discard':'consumer-stage-discard').props.onClick();await h.flush();await p.flush();assert(!p.nodes().some(node=>node.props?.['data-testid']==='stage-draft-gate'));assert(!p.nodes().some(node=>node.type===childType));h.unmount();p.unmount();
});

for(const engine of ['pygas.build','gpumd.sampling'])test(engine+' known in-flight save survives remount and cannot be cleared by an early read or discard',async()=>{
 const gate=deferred(),env=workflowExperienceEnvironment(),p=mountPage(env),isBuild=engine==='pygas.build',childType=isBuild?'./TaskStageEditor':'./ConsumerStageEditor',file=isBuild?build:consumer,calls=[],saved=[];await readyPage(p);const api={inspect:async()=>{calls.push('inspect');return isBuild?buildStage():consumerStage();},propose:async()=>({taskId:'task-A',engine,proposalId:'preview',files:[]}),save:async()=>{calls.push('save');return gate.promise;}},props={...p.find(node=>node.type===childType).props,api,onSaved:()=>saved.push('old owner')},inspect=isBuild?'stage-inspect':'consumer-stage-inspect',discard=isBuild?'stage-discard':'consumer-stage-discard',save=isBuild?'stage-save':'consumer-stage-save';let h=env.mount(file,props);await h.flush();if(!isBuild){h.find(node=>node.props?.id==='consumer-stage-engine').props.onChange({target:{value:engine}});await h.flush();}h.id(inspect).props.onClick();await h.flush();if(isBuild)h.find(node=>node.type==='ParameterFields'&&node.props.fields[0].key==='cutoff').props.onChange('cutoff',6);else h.find(node=>node.type==='GroupedParameterFields').props.onChange('temperature_K',360);await h.flush();if(!isBuild){h.id('consumer-stage-preview').props.onClick();await h.flush();}const saveClick=h.id(save).props.onClick;saveClick();saveClick();await h.flush();assert.equal(calls.filter(call=>call==='save').length,1);h.unmount();
 h=env.mount(file,props);await h.flush();await p.flush();h.id(isBuild?'stage-save-pending':'consumer-save-pending');assert.equal(h.id(inspect).props.disabled,true);assert.equal(h.id(discard).props.disabled,true);const reads=calls.length;h.id(inspect).props.onClick();h.id(discard).props.onClick();await h.flush();await p.flush();assert.equal(calls.length,reads);assert.equal(p.id('review-workflow').props.disabled,true);assert.equal(sessionStore(env).readSessionDraft(stageStore(env).stageDraftKey('task-A',engine)).value.uncertain,true);
 h.props({taskId:'task-B'});await h.flush();gate.resolve({taskId:'task-A',status:'draft',review:'not_run',execution:'not_run'});await h.flush();await p.flush();assert.deepEqual(saved,[],'A late acknowledgement must not call the abandoned owner callback');assert.equal(h.id(isBuild?'task-stage-editor':'consumer-stage-editor').props['data-task-id'],'task-B');assert(!h.nodes().some(node=>node.props?.['data-testid']===(isBuild?'stage-save-pending':'consumer-save-pending')));assert.equal(p.id('review-workflow').props.disabled,false);h.unmount();p.unmount();
});

test('the stage gate remains until the acknowledged save refresh has completed',async()=>{
 const refresh=deferred(),env=workflowExperienceEnvironment(),p=mountPage(env),h=env.mount(build,{taskId:'task-A',revision:1,workerReady:true,api:{inspect:async()=>buildStage(),save:async()=>({taskId:'task-A',status:'draft'})},onSaved:()=>refresh.promise});await readyPage(p);await h.flush();h.id('stage-inspect').props.onClick();await h.flush();h.find(node=>node.type==='ParameterFields'&&node.props.fields[0].key==='cutoff').props.onChange('cutoff',5);await h.flush();h.id('stage-save').props.onClick();await h.flush();await p.flush();assert.equal(sessionStore(env).readSessionDraft(stageStore(env).stageDraftKey('task-A','pygas.build')),undefined);assert.equal(p.id('review-workflow').props.disabled,true);refresh.resolve();await h.flush();await p.flush();assert.equal(p.id('review-workflow').props.disabled,false);h.unmount();p.unmount();
});
