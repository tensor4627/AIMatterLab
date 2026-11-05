// Actual production Panel/hook source; controlled component transports only, no real job execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {toolWorkflowsHarness,workflowRead,groupRecord,executionConfiguration} from './helpers/tool-workflows-components.mjs';

const calls=(h,method,start=0)=>h.calls.slice(start).filter(call=>call.method===method);
const node=(h,id)=>h.find(value=>value.props?.['data-testid']===id);
const button=(h,label)=>h.find(value=>value.type==='button'&&h.text(value)===label);
async function twoExecutions(){const h=toolWorkflowsHarness({withWorkflow:true});h.data.executions.set('execution-B',workflowRead({id:'execution-B'}));await h.flush();h.change('工具组执行快照','execution-A');await h.flush();return h;}
async function configured(){const h=toolWorkflowsHarness(),other=groupRecord({id:'other-group',count:1});h.data.groups.set(other.id,other);h.data.versions.set(other.version,other);h.data.configurations.set('configuration-B',executionConfiguration(h.data.record,'configuration-B'));await h.flush();h.change('工具组定义','cpu-sequence');await h.flush();for(const id of ['step-1','step-2']){h.change('步骤配置 '+id,'configuration-A');await h.flush();}assert.equal(node(h,'tool-workflow-create').props.disabled,false);return h;}
async function builder(){const h=toolWorkflowsHarness();await h.flush();h.change('新工具组参考配置','configuration-A');await h.flush();h.change('新工具组功能','process');h.change('新工具组 ID','reviewed-builder');return h;}

test('a captured prepare button cannot prepare execution A after execution B was selected',async()=>{
 const h=await twoExecutions();try{const old=node(h,'tool-step-prepare-step-1');h.change('工具组执行快照','execution-B');await h.flush();assert(h.text(node(h,'tool-workflow-execution')).includes('execution-B'));const before=h.calls.length;old.props.onClick();await h.flush();assert.equal(calls(h,'tools.workflows.prepareStep',before).length,0);assert(h.text(node(h,'tool-workflow-execution')).includes('execution-B'));}finally{h.unmount();}
});

test('a captured prepared execution A button cannot execute after selecting execution B',async()=>{
 const h=await twoExecutions();try{h.click('tool-step-prepare-step-1');await h.flush();const old=node(h,'tool-step-execute-step-1');assert.equal(old.props.disabled,false);h.change('工具组执行快照','execution-B');await h.flush();const before=h.calls.length;old.props.onClick();await h.flush();assert.equal(calls(h,'tools.workflows.executeStep',before).length,0);assert.equal(h.data.executions.get('execution-A').execution.steps[0].status,'prepared');}finally{h.unmount();}
});

test('captured prepare/execute controls cannot reuse an older revision of the same execution',async()=>{
 for(const phase of ['prepare','execute']){const h=await twoExecutions();try{if(phase==='execute'){h.click('tool-step-prepare-step-1');await h.flush();}const old=node(h,'tool-step-'+phase+'-step-1'),value=h.data.executions.get('execution-A');value.execution.revision++;if(phase==='execute'){value.execution.status='stale';value.execution.steps[0].status='stale';value.execution.steps[0].reason='Controlled changed-environment observation';}h.click('核对原流程状态');await h.flush();const before=h.calls.length;old.props.onClick();await h.flush();assert.equal(calls(h,'tools.workflows.'+(phase==='prepare'?'prepareStep':'executeStep'),before).length,0);}finally{h.unmount();}}
});

test('a captured create handler cannot use an earlier group/configuration selection',async()=>{
 for(const change of ['group','configuration']){const h=await configured();try{const old=node(h,'tool-workflow-create');if(change==='group')h.change('工具组定义','other-group');else h.change('步骤配置 step-1','configuration-B');await h.flush();const before=h.calls.length;old.props.onClick();await h.flush();assert.equal(calls(h,'tools.workflows.create',before).length,0);}finally{h.unmount();}}
});

test('builder edits invalidate a captured compile action rather than compiling a hidden old ID',async()=>{
 const h=await builder();try{const old=button(h,'编译有序 CPU 组定义');assert.equal(old.props.disabled,false);h.change('新工具组 ID','replacement-builder');const before=h.calls.length;old.props.onClick();await h.flush();assert.equal(calls(h,'tools.groups.compile',before).length,0);assert.throws(()=>node(h,'tool-group-draft'),/not found/);}finally{h.unmount();}
});

test('builder edits invalidate a captured save action rather than freezing the old hidden draft',async()=>{
 const h=await builder();try{h.click('编译有序 CPU 组定义');await h.flush();const old=button(h,'保存并冻结此定义');h.change('新工具组 ID','replacement-builder');const before=h.calls.length;old.props.onClick();await h.flush();assert.equal(calls(h,'tools.groups.save',before).length,0);assert.equal(h.data.groups.has('reviewed-builder'),false);}finally{h.unmount();}
});

test('captured configuration and execution selectors cannot overwrite a newer group selection',async()=>{
 for(const kind of ['configuration','execution']){const h=await configured();try{if(kind==='execution'){h.data.executions.set('execution-A',workflowRead());h.click('刷新流程目录');await h.flush();}const old=h.find(value=>value.type==='select'&&value.props['aria-label']===(kind==='configuration'?'步骤配置 step-2':'工具组执行快照'));h.change('工具组定义','other-group');await h.flush();const before=h.calls.length;old.props.onChange({target:{value:kind==='configuration'?'configuration-A':'execution-A'}});await h.flush();assert.equal(calls(h,kind==='configuration'?'tools.configurations.read':'tools.workflows.read',before).length,0);assert(h.text(node(h,'tool-workflow-group')).includes('other-group')||h.find(value=>value.props?.['aria-label']==='工具组定义').props.value==='other-group');}finally{h.unmount();}}
});

test('current explicit prepare, execute and builder actions continue working after discarded stale controls',async()=>{
 const h=await twoExecutions();try{const old=node(h,'tool-step-prepare-step-1');h.change('工具组执行快照','execution-B');await h.flush();old.props.onClick();await h.flush();const before=h.calls.length;h.click('tool-step-prepare-step-1');await h.flush();assert.equal(calls(h,'tools.workflows.prepareStep',before).length,1);assert.equal(calls(h,'tools.workflows.prepareStep',before)[0].data.execution_id,'execution-B');h.click('tool-step-execute-step-1');await h.flush();assert.equal(calls(h,'tools.workflows.executeStep',before).length,1);}finally{h.unmount();}
 const b=await builder();try{b.change('新工具组 ID','current-builder');b.click('编译有序 CPU 组定义');await b.flush();b.click('保存并冻结此定义');await b.flush();assert.equal(b.data.groups.has('current-builder'),true);}finally{b.unmount();}
});
